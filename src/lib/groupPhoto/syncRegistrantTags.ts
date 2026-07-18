import { prisma } from "@/lib/prisma";
import { normalizeCode } from "./normalizeCode";
import { resolveRegistrantGroupPhotoName } from "./registrantDisplayName";
import { stampRegistrantPhotoEvent } from "./resolveTagMatch";
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
 *
 * Event-scoped on the "claim" side: a registrant with no `photoEventId` stamped yet is only a
 * candidate for tags in photos whose event window contains their `registeredAt` (same
 * bootstrap-then-stick rule as resolveTagMatch.ts); once stamped, only tags in that same event.
 * The "release" side (tags this registrant is already linked to) is never event-filtered — those
 * links are real regardless of event and must stay releasable.
 */
export async function syncRegistrantGroupPhotoTags(universityId: string, registrantId: string): Promise<void> {
  const registrant = await prisma.registrant.findUnique({
    where: { id: registrantId },
    select: { displayName: true, data: true, photoEventId: true, registeredAt: true },
  });
  if (!registrant) return;

  const data = (registrant.data ?? {}) as Record<string, unknown>;
  const rawCode = data.group_photo_index;
  const currentCode = typeof rawCode === "string" ? normalizeCode(rawCode) : "";
  const name = resolveRegistrantGroupPhotoName(registrant);

  const baseGroupPhotoFilter = { universityId, status: { not: GroupPhotoStatus.DONE } };
  const eventFilter = registrant.photoEventId
    ? { photoEventId: registrant.photoEventId }
    : {
        photoEvent: {
          startDate: { lte: registrant.registeredAt },
          endDate: { gte: registrant.registeredAt },
        },
      };

  // Any tag either currently claimed by this registrant (may need releasing, if their code moved
  // on) or matching their current code within an event they're eligible for (may need claiming) —
  // never touches a photo an admin has already marked DONE, mirroring autoSyncGroupPhotoTags'
  // same freeze signal.
  const candidates = await prisma.groupPhotoTag.findMany({
    where: {
      OR: [
        { registrantId, groupPhoto: baseGroupPhotoFilter },
        ...(currentCode
          ? [{ normalizedCode: currentCode, groupPhoto: { ...baseGroupPhotoFilter, ...eventFilter } }]
          : []),
      ],
    },
    include: { groupPhoto: { select: { photoEventId: true } } },
  });
  if (candidates.length === 0) return;

  const released = candidates.filter((t) => t.registrantId === registrantId && t.normalizedCode !== currentCode);
  const referenceRows = released.length
    ? await prisma.groupPhotoLegacyReference.findMany({
        where: {
          universityId,
          OR: released.map((t) => ({ photoEventId: t.groupPhoto.photoEventId, normalizedCode: t.normalizedCode })),
        },
      })
    : [];
  const referenceByEventAndCode = new Map(referenceRows.map((r) => [`${r.photoEventId}:${r.normalizedCode}`, r]));

  for (const tag of candidates) {
    const isCurrentMatch = !!currentCode && tag.normalizedCode === currentCode;
    let next: { name: string; registrantId: string | null; matchSource: TagMatchSource } | null = null;

    if (isCurrentMatch) {
      // A human-overridden name is never reverted, even as registrantId/matchSource stay synced
      // to whichever registrant now actually owns this code — "แก้เอง = เด็ดขาด".
      const nextName = tag.nameOverridden ? tag.name : name;
      if (tag.registrantId !== registrantId || tag.name !== nextName || tag.matchSource !== TagMatchSource.REGISTRANT) {
        next = { name: nextName, registrantId, matchSource: TagMatchSource.REGISTRANT };
      }
    } else if (tag.registrantId === registrantId) {
      const ref = referenceByEventAndCode.get(`${tag.groupPhoto.photoEventId}:${tag.normalizedCode}`);
      const nextName = tag.nameOverridden ? tag.name : ref?.name;
      next = ref
        ? { name: nextName ?? ref.name, registrantId: null, matchSource: TagMatchSource.LEGACY_REFERENCE }
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
    if (next.matchSource === TagMatchSource.REGISTRANT && next.registrantId) {
      await stampRegistrantPhotoEvent(prisma, next.registrantId, tag.groupPhoto.photoEventId);
    }
  }
}
