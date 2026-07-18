import { prisma } from "@/lib/prisma";
import { normalizeCode } from "./normalizeCode";
import { resolveRegistrantGroupPhotoName } from "./registrantDisplayName";
import { TagMatchSource } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

export type TagMatchMaps = {
  registrantByCode: Map<string, { id: string; name: string }>;
  referenceByCode: Map<string, { name: string }>;
};

export type TagMatch = { name: string; registrantId: string | null; matchSource: TagMatchSource };

/**
 * One source of truth for "what registrant/legacy-reference does this code currently belong to
 * WITHIN THIS EVENT", shared by every place that needs it: the bulk auto-sync passes
 * (autoSyncGroupPhotoTags, syncRegistrantGroupPhotoTags), the admin dialog save, and the
 * public/share-link edit actions.
 *
 * Event-scoped since the same university can run this event more than once with overlapping
 * dates AND overlapping group_photo_index code ranges (e.g. KKU67 codes 1000-5000, KKU68 codes
 * 3000-7000, same LINE channel) — a code alone can't disambiguate which event's registrant it
 * belongs to. A registrant is a candidate for event E if EITHER it's already been stamped
 * `photoEventId = E.id` by a prior successful match (see `stampRegistrantPhotoEvent` below), OR
 * it has no event stamped yet and its `registeredAt` falls inside E's `[startDate, endDate]`
 * window (the bootstrap heuristic for a registrant nobody has matched into any event yet). Once
 * stamped, a registrant is never reconsidered as a candidate for a different, later event — this
 * is what stops a second overlapping-date event from silently re-claiming an already-claimed
 * registrant just because its code also happens to fall in the second event's range.
 *
 * Legacy-reference rows are matched directly by `photoEventId` with no date-bootstrap — that
 * data is always imported as an explicit per-event admin action, so there's nothing to bootstrap.
 */
/**
 * The shared "does this registrant belong to event E" filter — same bootstrap-then-stick rule
 * documented above, factored out so display-side filtering (the group-photos/registrants admin
 * pages' event-scope dropdown) and match-time filtering (`buildTagMatchMaps` below) can never
 * drift into two different definitions of "belongs to this event." Takes the event's own
 * `startDate`/`endDate` rather than re-fetching them, since callers usually already have the
 * `PhotoEvent` row in hand.
 */
export function buildEventScopedRegistrantWhere(
  universityId: string,
  photoEventId: string,
  eventWindow: { startDate: Date; endDate: Date },
): Prisma.RegistrantWhereInput {
  return {
    universityId,
    OR: [
      { photoEventId },
      { photoEventId: null, registeredAt: { gte: eventWindow.startDate, lte: eventWindow.endDate } },
    ],
  };
}

export async function buildTagMatchMaps(universityId: string, photoEventId: string): Promise<TagMatchMaps> {
  const event = await prisma.photoEvent.findUniqueOrThrow({
    where: { id: photoEventId, universityId },
    select: { startDate: true, endDate: true },
  });

  const [registrantRows, referenceRows] = await Promise.all([
    prisma.registrant.findMany({
      where: buildEventScopedRegistrantWhere(universityId, photoEventId, event),
      select: { id: true, displayName: true, data: true },
    }),
    prisma.groupPhotoLegacyReference.findMany({
      where: { universityId, photoEventId },
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
  const referenceByCode = new Map(referenceRows.map((r) => [r.normalizedCode, { name: r.name }]));

  return { registrantByCode, referenceByCode };
}

/** Registrant match always wins over a legacy-reference match for the same code — matches the
 * priority already used everywhere else (autofill chain, cross-photo source resolution, etc). */
export function resolveTagMatch(normalizedCode: string, maps: TagMatchMaps): TagMatch | null {
  if (!normalizedCode) return null;
  const reg = maps.registrantByCode.get(normalizedCode);
  if (reg) return { name: reg.name, registrantId: reg.id, matchSource: TagMatchSource.REGISTRANT };
  const ref = maps.referenceByCode.get(normalizedCode);
  if (ref) return { name: ref.name, registrantId: null, matchSource: TagMatchSource.LEGACY_REFERENCE };
  return null;
}

/**
 * Stamps a registrant to the event whose tag just matched them, but only if they don't already
 * belong to one — sticky by design (see buildTagMatchMaps' doc comment). A no-op update (affects
 * 0 rows) when the registrant is already stamped to ANY event, including this same one, so it's
 * safe to call unconditionally every time a REGISTRANT match is applied to a tag, without an
 * extra read first. Takes an explicit client (the singleton `prisma`, or an open `tx`) so callers
 * that need this inside a larger transaction get one atomic unit of work, not two.
 */
export async function stampRegistrantPhotoEvent(
  db: Prisma.TransactionClient,
  registrantId: string,
  photoEventId: string,
): Promise<void> {
  await db.registrant.updateMany({
    where: { id: registrantId, photoEventId: null },
    data: { photoEventId },
  });
}
