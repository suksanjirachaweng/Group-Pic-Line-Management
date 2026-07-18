import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { buildEventArchiveData } from "@/lib/photoEvent/buildEventArchiveData";
import { uploadArchiveDataJson, copyImageToArchive } from "@/lib/photoEvent/archiveStorage";
import { PhotoEventStatus } from "@/generated/prisma/enums";
import type { PhotoEventArchiveJob } from "@/generated/prisma/client";

// Hobby-plan cap — the COPYING_IMAGES stage's own soft time budget below stays comfortably under
// this so the route always returns a real response instead of getting killed mid-tick.
export const maxDuration = 60;
const TIME_BUDGET_MS = 45_000;
const IMAGE_COPY_CONCURRENCY = 3;

/** Claims exactly one non-terminal job per tick — same FOR UPDATE SKIP LOCKED pattern as
 * process-group-photo-auto-tag-jobs, for the same reason (the actual work below is way too slow
 * to hold a DB lock across). */
async function claimJob(): Promise<PhotoEventArchiveJob | null> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "photo_event_archive_jobs"
      WHERE "stage" IN ('EXPORTING_DATA', 'COPYING_IMAGES')
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;
    if (rows.length === 0) return null;
    return tx.photoEventArchiveJob.findUniqueOrThrow({ where: { id: rows[0].id } });
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
    await prisma.photoEvent.update({
      where: { id: job.photoEventId },
      data: { status: PhotoEventStatus.ARCHIVE_READY, archivedAt: new Date() },
    });
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
  await prisma.photoEventArchiveJob.update({
    where: { id: job.id },
    data: {
      imagesDone: next,
      stage: done ? "DONE" : "COPYING_IMAGES",
      completedAt: done ? new Date() : null,
    },
  });
  if (done) {
    await prisma.photoEvent.update({
      where: { id: job.photoEventId },
      data: { status: PhotoEventStatus.ARCHIVE_READY, archivedAt: new Date() },
    });
  }
}

async function handle(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const job = await claimJob();
  if (!job) return NextResponse.json({ processed: false });

  try {
    if (job.stage === "EXPORTING_DATA") {
      await processExportingDataStage(job);
    } else if (job.stage === "COPYING_IMAGES") {
      await processCopyingImagesStage(job);
    }
    return NextResponse.json({ processed: true, jobId: job.id, stage: job.stage });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.photoEventArchiveJob.update({
      where: { id: job.id },
      data: { stage: "FAILED", errorMessage: message },
    });
    return NextResponse.json({ processed: true, jobId: job.id, failed: true, error: message });
  }
}

export const GET = handle;
export const POST = handle;
