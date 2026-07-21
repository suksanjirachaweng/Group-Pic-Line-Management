import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { buildEventArchiveData } from "@/lib/photoEvent/buildEventArchiveData";
import { uploadArchiveDataJson, copyImageToArchive } from "@/lib/photoEvent/archiveStorage";
import { isPcPhotoServerConfigured, embedFace } from "@/lib/pcPhotoServer";
import { recordCronHeartbeat } from "@/lib/cronHeartbeat";
import { PhotoEventStatus } from "@/generated/prisma/enums";
import type { PhotoEventArchiveJob } from "@/generated/prisma/client";

const JOB_KEY = "process-photo-event-archive-jobs";

// Hobby-plan cap — the COPYING_IMAGES/EMBEDDING_FACES stages' own soft time budget below stays
// comfortably under this so the route always returns a real response instead of getting killed
// mid-tick.
export const maxDuration = 60;
const TIME_BUDGET_MS = 45_000;
const IMAGE_COPY_CONCURRENCY = 3;
const FACE_EMBED_CONCURRENCY = 2; // each call does real CPU-bound ML inference on the PC server — gentler than image copying

// Generous crop window around a tag's (x,y) point before handing off to the PC server's own
// detector — these group photos can be extremely high-res (15000px+ wide) with many people per
// frame, and a too-tight window can miss the actual face entirely. Same size validated in the
// de-risk spike (pc-photo-server/spike-face-recognition) against real production photos.
const FACE_CROP_SIZE = 1400;

/** Claims exactly one non-terminal job per tick — same FOR UPDATE SKIP LOCKED pattern as
 * process-group-photo-auto-tag-jobs, for the same reason (the actual work below is way too slow
 * to hold a DB lock across). */
async function claimJob(): Promise<PhotoEventArchiveJob | null> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "photo_event_archive_jobs"
      WHERE "stage" IN ('EXPORTING_DATA', 'COPYING_IMAGES', 'EMBEDDING_FACES')
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;
    if (rows.length === 0) return null;
    return tx.photoEventArchiveJob.findUniqueOrThrow({ where: { id: rows[0].id } });
  });
}

async function finishArchive(photoEventId: string) {
  // Also hides the event from the student-facing LIFF list — a closed-out event has no reason to
  // keep showing there, and leaving it visible would surface registrants whose data is about to be
  // deleted entirely. Independent of `hiddenFromLiff`'s normal manual toggle (see
  // setPhotoEventLiffVisibility), but reuses the same field.
  await prisma.photoEvent.update({
    where: { id: photoEventId },
    data: { status: PhotoEventStatus.ARCHIVE_READY, archivedAt: new Date(), hiddenFromLiff: true },
  });
}

async function processExportingDataStage(job: PhotoEventArchiveJob) {
  const bundle = await buildEventArchiveData(job.photoEventId);
  const dataJsonUrl = await uploadArchiveDataJson(job.photoEventId, bundle);

  await prisma.$transaction([
    prisma.photoEvent.update({ where: { id: job.photoEventId }, data: { archiveFileUrl: dataJsonUrl } }),
    prisma.photoEventArchiveJob.update({
      where: { id: job.id },
      data: {
        imagesTotal: bundle.groupPhotos.length,
        stage: bundle.groupPhotos.length > 0 ? "COPYING_IMAGES" : "DONE",
        completedAt: bundle.groupPhotos.length > 0 ? null : new Date(),
      },
    }),
  ]);
  if (bundle.groupPhotos.length === 0) {
    await finishArchive(job.photoEventId);
  }
}

async function processCopyingImagesStage(job: PhotoEventArchiveJob) {
  const photos = await prisma.groupPhoto.findMany({
    where: { photoEventId: job.photoEventId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, imageUrl: true },
  });

  const startedAt = Date.now();
  let next = job.imagesDone;

  async function worker() {
    while (next < photos.length && Date.now() - startedAt < TIME_BUDGET_MS) {
      const index = next++;
      const photo = photos[index];
      try {
        await copyImageToArchive(job.photoEventId, photo.id, photo.imageUrl);
      } catch (err) {
        // One photo failing to copy shouldn't fail the whole event archive — same
        // graceful-degradation stance as the auto-tag OCR stage's per-tile catch. Surfaced via the
        // job staying non-DONE forever isn't ideal, but a hard failure here would block close-out
        // entirely over one bad image URL; logging + counting it as attempted is the pragmatic call.
        console.error(`Archive job ${job.id}: photo ${photo.id} copy failed:`, err);
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(IMAGE_COPY_CONCURRENCY, photos.length - next) || 1 }, worker),
  );

  const done = next >= photos.length;
  if (!done) {
    await prisma.photoEventArchiveJob.update({ where: { id: job.id }, data: { imagesDone: next } });
    return;
  }

  // Face backup is optional (skipped entirely if the operator hasn't set up PC-server face
  // recognition) — jump straight to DONE rather than leaving the job stuck in a stage that will
  // never advance.
  if (!isPcPhotoServerConfigured()) {
    await prisma.photoEventArchiveJob.update({
      where: { id: job.id },
      data: { imagesDone: next, stage: "DONE", completedAt: new Date() },
    });
    await finishArchive(job.photoEventId);
    return;
  }

  const facesTotal = await prisma.groupPhotoTag.count({
    where: {
      row: 0,
      name: { not: "" },
      OR: [{ reportedProblem: false }, { problemAcknowledged: true }],
      groupPhoto: { photoEventId: job.photoEventId },
    },
  });
  await prisma.photoEventArchiveJob.update({
    where: { id: job.id },
    data: { imagesDone: next, facesTotal, stage: facesTotal > 0 ? "EMBEDDING_FACES" : "DONE", completedAt: facesTotal > 0 ? null : new Date() },
  });
  if (facesTotal === 0) await finishArchive(job.photoEventId);
}

async function processEmbeddingFacesStage(job: PhotoEventArchiveJob) {
  const tags = await prisma.groupPhotoTag.findMany({
    where: {
      row: 0,
      name: { not: "" },
      OR: [{ reportedProblem: false }, { problemAcknowledged: true }],
      groupPhoto: { photoEventId: job.photoEventId },
    },
    orderBy: [{ id: "asc" }],
    select: {
      id: true,
      name: true,
      x: true,
      y: true,
      updatedAt: true,
      groupPhoto: { select: { imageUrl: true, imageWidth: true, imageHeight: true } },
    },
  });

  // One batched lookup instead of a query per tag — lets each worker skip the expensive
  // fetch+crop+PC-server round trip entirely when this exact tag (same id, unchanged since) was
  // already the source of that name's current profile. Re-running the button (or running a full
  // archive after already building the face bank standalone) then does real work only for
  // genuinely new/edited tags, not every eligible tag in the event again.
  const existingProfiles = await prisma.facultyFaceProfile.findMany({
    where: { name: { in: [...new Set(tags.map((t) => t.name))] } },
    select: { name: true, lastEmbeddedTagId: true, lastEmbeddedTagUpdatedAt: true },
  });
  const existingByName = new Map(existingProfiles.map((p) => [p.name, p]));

  const startedAt = Date.now();
  let next = job.facesDone;

  async function worker() {
    while (next < tags.length && Date.now() - startedAt < TIME_BUDGET_MS) {
      const index = next++;
      const tag = tags[index];
      const existing = existingByName.get(tag.name);
      if (
        existing &&
        existing.lastEmbeddedTagId === tag.id &&
        existing.lastEmbeddedTagUpdatedAt?.getTime() === tag.updatedAt.getTime()
      ) {
        continue; // unchanged since last embed — nothing to do
      }
      try {
        const { imageUrl, imageWidth, imageHeight } = tag.groupPhoto;
        const half = FACE_CROP_SIZE / 2;
        const left = Math.max(0, Math.min(imageWidth - FACE_CROP_SIZE, Math.round(tag.x - half)));
        const top = Math.max(0, Math.min(imageHeight - FACE_CROP_SIZE, Math.round(tag.y - half)));
        const resp = await fetch(imageUrl);
        if (!resp.ok) throw new Error(`Failed to fetch photo image (${resp.status})`);
        const fullBuf = Buffer.from(await resp.arrayBuffer());
        const cropBuf = await sharp(fullBuf)
          .extract({
            left,
            top,
            width: Math.min(FACE_CROP_SIZE, imageWidth),
            height: Math.min(FACE_CROP_SIZE, imageHeight),
          })
          .jpeg({ quality: 90 })
          .toBuffer();

        const result = await embedFace(cropBuf);
        if (result) {
          await prisma.facultyFaceProfile.upsert({
            where: { name: tag.name },
            create: {
              name: tag.name,
              embedding: result.embedding,
              sourceCropUrl: result.cropUrl,
              lastSeenPhotoEventId: job.photoEventId,
              lastEmbeddedTagId: tag.id,
              lastEmbeddedTagUpdatedAt: tag.updatedAt,
              timesMatched: 1,
            },
            update: {
              embedding: result.embedding,
              sourceCropUrl: result.cropUrl,
              lastSeenPhotoEventId: job.photoEventId,
              lastEmbeddedTagId: tag.id,
              lastEmbeddedTagUpdatedAt: tag.updatedAt,
              timesMatched: { increment: 1 },
            },
          });
        }
      } catch (err) {
        // One face failing to embed (bad crop, transient PC-server hiccup, no confident face in
        // the window) shouldn't fail the whole event archive — same graceful-degradation stance
        // as the image-copy stage.
        console.error(`Archive job ${job.id}: face embed for "${tag.name}" failed:`, err);
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(FACE_EMBED_CONCURRENCY, tags.length - next) || 1 }, worker),
  );

  const done = next >= tags.length;
  await prisma.photoEventArchiveJob.update({
    where: { id: job.id },
    data: { facesDone: next, stage: done ? "DONE" : "EMBEDDING_FACES", completedAt: done ? new Date() : null },
  });
  // A facesOnly job (the standalone "ดึงเข้าคลังใบหน้า" button) never exported/copied/closed
  // anything — finishing it must not flip PhotoEvent.status to ARCHIVE_READY.
  if (done && !job.facesOnly) await finishArchive(job.photoEventId);
}

async function handle(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const job = await claimJob();
    if (!job) {
      await recordCronHeartbeat(JOB_KEY, "OK");
      return NextResponse.json({ processed: false });
    }

    try {
      if (job.stage === "EXPORTING_DATA") {
        await processExportingDataStage(job);
      } else if (job.stage === "COPYING_IMAGES") {
        await processCopyingImagesStage(job);
      } else if (job.stage === "EMBEDDING_FACES") {
        await processEmbeddingFacesStage(job);
      }
      await recordCronHeartbeat(JOB_KEY, "OK");
      return NextResponse.json({ processed: true, jobId: job.id, stage: job.stage });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.photoEventArchiveJob.update({
        where: { id: job.id },
        data: { stage: "FAILED", errorMessage: message },
      });
      await recordCronHeartbeat(JOB_KEY, "OK");
      return NextResponse.json({ processed: true, jobId: job.id, failed: true, error: message });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordCronHeartbeat(JOB_KEY, "ERROR", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
