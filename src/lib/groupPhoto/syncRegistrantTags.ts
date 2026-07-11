import { prisma } from "@/lib/prisma";
import { normalizeCode } from "./normalizeCode";
import { TagMatchSource, GroupPhotoStatus, TagHistorySource } from "@/generated/prisma/enums";

/**
 * Keeps GroupPhotoTag.registrantId/name/matchSource in sync with one specific registrant's
 * current group_photo_index, right after they save a registration edit — without this, a
 * graduate who corrects a mistyped code in LINE stays invisibly linked to their old tag until an
 * admin happens to reopen the tagging page (the bulk `autoSyncGroupPhotoTags` only runs then, and
 * plenty of graduates never revisit their self-check link to trigger the page-load fallback
 * there either). Scoped to just this registrant's own tags, so it's cheap enough to call on
 * every save. No-session-required by design (called from the public /api/register route) and
 * best-effort — the caller wraps this so a bug here never fails the registration save itself.
 */
export async function syncRegistrantGroupPhotoTags(universityId: string, registrantId: string): Promise<void> {
  const registrant = await prisma.registrant.findUnique({
    where: { id: registrantId },
    select: { displayName: true, data: true },
  });
  if (!registrant) return;

  const data = (registrant.data ?? {}) as Record<string, unknown>;
  const rawCode = data.group_photo_index;
  const currentCode = typeof rawCode === "string" ? normalizeCode(rawCode) : "";
  const name = registrant.displayName?.trim() || "(ไม่มีชื่อ)";

  // Any tag either currently claimed by this registrant (may need releasing, if their code moved
  // on) or matching their current code (may need claiming) — never touches a photo an admin has
  // already marked DONE, mirroring autoSyncGroupPhotoTags' same freeze signal.
  const candidates = await prisma.groupPhotoTag.findMany({
    where: {
      groupPhoto: { universityId, status: { not: GroupPhotoStatus.DONE } },
      OR: [{ registrantId }, ...(currentCode ? [{ normalizedCode: currentCode }] : [])],
    },
  });
  if (candidates.length === 0) return;

  const releasedCodes = candidates
    .filter((t) => t.registrantId === registrantId && t.normalizedCode !== currentCode)
    .map((t) => t.normalizedCode);
  const referenceRows = releasedCodes.length
    ? await prisma.groupPhotoLegacyReference.findMany({
        where: { universityId, normalizedCode: { in: releasedCodes } },
      })
    : [];
  const referenceByCode = new Map(referenceRows.map((r) => [r.normalizedCode, r]));

  for (const tag of candidates) {
    const isCurrentMatch = !!currentCode && tag.normalizedCode === currentCode;
    let next: { name: string; registrantId: string | null; matchSource: TagMatchSource } | null = null;

    if (isCurrentMatch) {
      if (tag.registrantId !== registrantId || tag.name !== name || tag.matchSource !== TagMatchSource.REGISTRANT) {
        next = { name, registrantId, matchSource: TagMatchSource.REGISTRANT };
      }
    } else if (tag.registrantId === registrantId) {
      const ref = referenceByCode.get(tag.normalizedCode);
      next = ref
        ? { name: ref.name, registrantId: null, matchSource: TagMatchSource.LEGACY_REFERENCE }
        : { name: tag.name, registrantId: null, matchSource: TagMatchSource.MANUAL };
    }
    if (!next) continue;

    await prisma.$transaction([
      prisma.groupPhotoTag.update({ where: { id: tag.id }, data: next }),
      prisma.groupPhotoTagHistory.create({
        data: {
          tagId: tag.id,
          code: tag.code,
          name: next.name,
          row: tag.row,
          order: tag.order,
          source: TagHistorySource.AUTO_SYNC,
        },
      }),
    ]);
  }
}
