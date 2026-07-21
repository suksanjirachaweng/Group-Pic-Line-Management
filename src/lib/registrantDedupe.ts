import "server-only";
import { prisma } from "@/lib/prisma";

// The two fields every university's default form includes (see DEFAULT_FORM_FIELDS in
// lib/actions/universities.ts) and that the rest of this app already treats as load-bearing keys
// (e.g. the LIFF registrations list matches by `group_photo_index`) — using them here too keeps
// "duplicate" consistent with how the rest of the system already identifies a registrant.
const NAME_KEY = "full_name";
const CODE_KEY = "group_photo_index";
const PHONE_KEY = "phone_number";

/**
 * A composite key for "this looks like the same person, same photo" — both fields must be
 * present and non-blank, or there's nothing safe to match on (returns null, meaning "never treat
 * as a duplicate"). Deliberately an exact, trimmed match only, not fuzzy — matching on name alone
 * would risk merging two different people who happen to share a common name.
 */
export function registrantDedupeKey(data: unknown): string | null {
  const d = (data ?? {}) as Record<string, unknown>;
  const name = typeof d[NAME_KEY] === "string" ? d[NAME_KEY].trim() : "";
  const code = typeof d[CODE_KEY] === "string" ? d[CODE_KEY].trim() : "";
  if (!name || !code) return null;
  return `${name} ${code}`;
}

/**
 * Finds a prior registrant for this exact LINE user + university whose name+code match — used at
 * registration time to update that row instead of silently creating another duplicate. Scoped to
 * one LINE user only (never merges across different people, even if two students happen to share
 * both a name and a code) and excludes `excludeRegistrantId` so an explicit edit of one's own
 * existing entry never matches itself.
 */
export async function findDuplicateRegistrant(
  universityId: string,
  lineUserId: string,
  data: unknown,
  excludeRegistrantId?: string,
): Promise<{ id: string } | null> {
  const key = registrantDedupeKey(data);
  if (!key) return null;

  const candidates = await prisma.registrant.findMany({
    where: { universityId, lineUserId, id: excludeRegistrantId ? { not: excludeRegistrantId } : undefined },
    select: { id: true, data: true },
  });
  const match = candidates.find((c) => registrantDedupeKey(c.data) === key);
  return match ? { id: match.id } : null;
}

export type MergeDuplicatesSummary = { groupsFound: number; registrantsMerged: number };

function mergeGroupKey(r: { lineUserId: string | null; data: unknown; photoEventId: string | null }): string | null {
  const baseKey = registrantDedupeKey(r.data);
  if (!baseKey) return null;
  const d = (r.data ?? {}) as Record<string, unknown>;
  const phone = typeof d[PHONE_KEY] === "string" ? d[PHONE_KEY].trim() : "";
  if (!phone) return null;
  return `${r.lineUserId ?? ""} ${baseKey} ${phone} ${r.photoEventId ?? "none"}`;
}

/**
 * One-time cleanup for duplicates that already exist (created before this dedup check existed, or
 * from before the LIFF list's own display bug was fixed — see the 2026-07-21 registrations route
 * fix). Groups registrants within one university by (lineUserId, name, code, phone, photoEventId
 * — see mergeGroupKey; stricter than registrantDedupeKey per an explicit follow-up ask that
 * name+code alone was too easy to over-merge), and for every group with more than one row: keeps
 * the earliest-registered one, re-points every GroupPhotoTag that pointed at a "losing" duplicate
 * onto the keeper before deleting the losers (cascade also removes their
 * MessageJob/MessageLog/RuleExecution history, which is fine here since these rows are genuine
 * duplicates of the surviving one, not distinct data). Never touches registrants without a
 * lineUserId (paper/legacy entries with no LIFF identity to group by) or without name+code+phone
 * all filled in.
 */
export async function mergeDuplicateRegistrantsForUniversity(universityId: string): Promise<MergeDuplicatesSummary> {
  const registrants = await prisma.registrant.findMany({
    where: { universityId, lineUserId: { not: null } },
    select: { id: true, lineUserId: true, data: true, photoEventId: true, registeredAt: true },
  });

  const groups = new Map<string, typeof registrants>();
  for (const r of registrants) {
    const key = mergeGroupKey(r);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  let groupsFound = 0;
  let registrantsMerged = 0;

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    groupsFound++;

    const keeper = group.reduce((a, b) => (a.registeredAt <= b.registeredAt ? a : b));
    const loserIds = group.filter((r) => r.id !== keeper.id).map((r) => r.id);
    if (loserIds.length === 0) continue;

    await prisma.$transaction([
      prisma.groupPhotoTag.updateMany({ where: { registrantId: { in: loserIds } }, data: { registrantId: keeper.id } }),
      prisma.registrant.deleteMany({ where: { id: { in: loserIds } } }),
    ]);
    registrantsMerged += loserIds.length;
  }

  return { groupsFound, registrantsMerged };
}
