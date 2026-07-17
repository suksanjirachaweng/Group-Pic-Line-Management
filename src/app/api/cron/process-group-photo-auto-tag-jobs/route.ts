import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { normalizeCode } from "@/lib/groupPhoto/normalizeCode";
import { resolveRegistrantGroupPhotoName } from "@/lib/groupPhoto/registrantDisplayName";
import { OCR_UPLOAD_SIZE, CONCURRENCY, computeTiles } from "@/lib/groupPhoto/tileGeometry";
import { resolveRowsForNewPoints, applyRowOrderShift, clusterIntoRows } from "@/lib/groupPhoto/rowClustering";
import { runCardGridOcr } from "@/lib/actions/bulkCardOcr";
import { createGroupPhotoTagCore } from "@/lib/actions/groupPhotos";
import { TagMatchSource } from "@/generated/prisma/enums";
import type { GroupPhoto, GroupPhotoAutoTagJob } from "@/generated/prisma/client";

// Hobby-plan cap — the OCR stage's own soft time budget below stays comfortably under this so the
// route always returns a real response instead of getting killed mid-tick.
export const maxDuration = 60;
const TIME_BUDGET_MS = 45_000;

type ClaimedJob = GroupPhotoAutoTagJob & { groupPhoto: GroupPhoto };

/**
 * Claims exactly one non-terminal job per tick. The row lock is only held for this SELECT — the
 * actual OCR/DB work below happens outside any transaction (holding a lock for a 45s Claude API
 * budget would block unrelated queries app-wide for no reason). This does leave a narrow window
 * for a slow-running tick to overlap with the next one, but every stage below is naturally
 * idempotent against that (ACCEPTING re-dedupes against existing tags, so a repeat run finds
 * nothing left to do) — not worth a second lock/marker field for what's a rare, harmless overlap.
 */
async function claimJob(): Promise<ClaimedJob | null> {
  const claimed = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "group_photo_auto_tag_jobs"
      WHERE "stage" IN ('OCR', 'ACCEPTING', 'FIXING_ORDER')
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;
    if (rows.length === 0) return null;
    return tx.groupPhotoAutoTagJob.findUniqueOrThrow({
      where: { id: rows[0].id },
      include: { groupPhoto: true },
    });
  });
  return claimed;
}

async function processOcrStage(job: ClaimedJob) {
  const photo = job.groupPhoto;
  const resp = await fetch(photo.imageUrl);
  if (!resp.ok) throw new Error(`Failed to fetch photo image (${resp.status})`);
  const fullBuf = Buffer.from(await resp.arrayBuffer());

  const tiles = computeTiles(photo.imageWidth, photo.imageHeight);
  const startedAt = Date.now();
  let next = job.tilesDone;

  async function worker() {
    while (next < tiles.length && Date.now() - startedAt < TIME_BUDGET_MS) {
      const tileIndex = next++;
      const tile = tiles[tileIndex];
      try {
        const scale = Math.min(1, OCR_UPLOAD_SIZE / Math.max(tile.width, tile.height));
        const tileBuf = await sharp(fullBuf)
          .extract({ left: tile.left, top: tile.top, width: tile.width, height: tile.height })
          .resize({ width: Math.round(tile.width * scale), height: Math.round(tile.height * scale) })
          .jpeg({ quality: 92 })
          .toBuffer();
        const { hits, width: uploadWidth, height: uploadHeight } = await runCardGridOcr(tileBuf, "image/jpeg");
        if (hits.length > 0) {
          await prisma.groupPhotoAutoTagHit.createMany({
            data: hits.map((hit) => ({
              jobId: job.id,
              tileIndex,
              code: hit.code,
              x: tile.left + (hit.x / uploadWidth) * tile.width,
              y: tile.top + (hit.y / uploadHeight) * tile.height,
            })),
          });
        }
      } catch (err) {
        // A single tile failing (e.g. a transient API hiccup) shouldn't fail the whole job — same
        // graceful-degradation stance as the client-driven bulk-OCR hook's per-tile catch. The
        // tile is still counted as "done" so the job doesn't get stuck retrying it forever.
        console.error(`Auto-tag job ${job.id}: tile ${tileIndex} failed:`, err);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tiles.length - next) || 1 }, worker));

  await prisma.groupPhotoAutoTagJob.update({
    where: { id: job.id },
    data: {
      tilesDone: next,
      stage: next >= tiles.length ? "ACCEPTING" : "OCR",
    },
  });
}

async function processAcceptingStage(job: ClaimedJob) {
  const photo = job.groupPhoto;

  const hitRows = await prisma.groupPhotoAutoTagHit.findMany({
    where: { jobId: job.id },
    orderBy: [{ tileIndex: "asc" }, { id: "asc" }],
  });
  // First tile to read a given code wins — matches useBulkCardOcr.ts's own de-dup rule.
  const seenCodes = new Set<string>();
  const deduped: { code: string; x: number; y: number }[] = [];
  for (const hit of hitRows) {
    if (seenCodes.has(hit.code)) continue;
    seenCodes.add(hit.code);
    deduped.push(hit);
  }

  const existingTagsFull = await prisma.groupPhotoTag.findMany({
    where: { groupPhotoId: photo.id },
    select: { id: true, x: true, y: true, row: true, order: true, normalizedCode: true },
  });
  const existingCodes = new Set(existingTagsFull.map((t) => t.normalizedCode));
  const toCreate = deduped.filter((c) => !existingCodes.has(normalizeCode(c.code)));

  if (toCreate.length > 0) {
    const [registrantRows, referenceRows] = await Promise.all([
      prisma.registrant.findMany({
        where: { universityId: photo.universityId },
        select: { id: true, displayName: true, data: true },
      }),
      prisma.groupPhotoLegacyReference.findMany({
        where: { universityId: photo.universityId },
        select: { name: true, normalizedCode: true },
      }),
    ]);
    const registrantByCode = new Map<string, { id: string; name: string }>();
    for (const r of registrantRows) {
      const data = (r.data ?? {}) as Record<string, unknown>;
      const rawCode = data.group_photo_index;
      if (typeof rawCode !== "string" || !rawCode.trim()) continue;
      const normalized = normalizeCode(rawCode);
      if (!normalized) continue;
      registrantByCode.set(normalized, { id: r.id, name: resolveRegistrantGroupPhotoName(r) });
    }
    const referenceByCode = new Map<string, { name: string }>();
    for (const r of referenceRows) referenceByCode.set(r.normalizedCode, { name: r.name });

    // A bulk-created batch redefines a big chunk of the photo's tagging state at once — same
    // reasoning as handleAcceptAllBulkOcrCandidates for why prior history no longer reads as a
    // meaningful audit trail against that new baseline.
    await prisma.groupPhotoTagHistory.deleteMany({ where: { tag: { groupPhotoId: photo.id } } });

    const rows = resolveRowsForNewPoints(
      existingTagsFull,
      toCreate.map((c, i) => ({ key: String(i), x: c.x, y: c.y })),
    );
    let running: { id: string; x: number; y: number; row: number; order: number }[] = existingTagsFull.map(
      (t) => ({ id: t.id, x: t.x, y: t.y, row: t.row, order: t.order }),
    );

    // One tag at a time (not a single giant transaction) — mirrors saveBulkOcrCandidate's own
    // sequential save loop, since each candidate's order depends on the running list having
    // already absorbed the previous candidate's insert.
    for (let i = 0; i < toCreate.length; i++) {
      const candidate = toCreate[i];
      const row = rows.get(String(i))!;
      const normalizedCode = normalizeCode(candidate.code);
      const reg = registrantByCode.get(normalizedCode);
      const ref = !reg ? referenceByCode.get(normalizedCode) : undefined;
      const name = reg ? reg.name : ref ? ref.name : "";
      const order = running.filter((t) => t.row === row && t.x < candidate.x).length;

      const created = await prisma.$transaction((tx) =>
        createGroupPhotoTagCore(tx, photo.id, {
          code: candidate.code,
          name,
          row,
          order,
          x: candidate.x,
          y: candidate.y,
          registrantId: reg ? reg.id : null,
          matchSource: reg
            ? TagMatchSource.REGISTRANT
            : ref
              ? TagMatchSource.LEGACY_REFERENCE
              : TagMatchSource.MANUAL,
          // Bulk-accepted hits always use the freshly-resolved match's own name verbatim — never
          // a human deviation, so never sticky.
          nameOverridden: false,
        }),
      );
      running = [
        ...applyRowOrderShift(running, undefined, row, order),
        { id: created.id, x: candidate.x, y: candidate.y, row, order },
      ];
    }
  }

  await prisma.groupPhotoAutoTagJob.update({ where: { id: job.id }, data: { stage: "FIXING_ORDER" } });
}

async function processFixingOrderStage(job: ClaimedJob) {
  const tags = await prisma.groupPhotoTag.findMany({
    where: { groupPhotoId: job.groupPhotoId },
    select: { id: true, x: true, y: true, row: true, order: true },
  });

  if (tags.length > 0) {
    // Same row-0-is-the-front-row convention as handleFixAllRowsAndOrder — row 0 sits LOWER in
    // the frame (larger Y) than the standing rows behind it.
    const clusters = clusterIntoRows(tags);
    const ordered = [...clusters].sort(
      (a, b) => b.reduce((s, t) => s + t.y, 0) / b.length - a.reduce((s, t) => s + t.y, 0) / a.length,
    );
    const updates: { id: string; row: number; order: number }[] = [];
    ordered.forEach((cluster, row) => {
      const sorted = [...cluster].sort((a, b) => a.x - b.x);
      sorted.forEach((tag, order) => {
        if (tag.row !== row || tag.order !== order) updates.push({ id: tag.id, row, order });
      });
    });
    if (updates.length > 0) {
      await prisma.$transaction(
        updates.map((u) => prisma.groupPhotoTag.update({ where: { id: u.id }, data: { row: u.row, order: u.order } })),
      );
    }
  }

  await prisma.groupPhotoAutoTagJob.update({
    where: { id: job.id },
    data: { stage: "DONE", completedAt: new Date() },
  });
}

async function handle(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const job = await claimJob();
  if (!job) return NextResponse.json({ processed: false });

  try {
    if (job.stage === "OCR") {
      await processOcrStage(job);
    } else if (job.stage === "ACCEPTING") {
      await processAcceptingStage(job);
    } else if (job.stage === "FIXING_ORDER") {
      await processFixingOrderStage(job);
    }
    return NextResponse.json({ processed: true, jobId: job.id, stage: job.stage });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.groupPhotoAutoTagJob.update({
      where: { id: job.id },
      data: { stage: "FAILED", errorMessage: message },
    });
    return NextResponse.json({ processed: true, jobId: job.id, failed: true, error: message });
  }
}

export const GET = handle;
export const POST = handle;
