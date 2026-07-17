import { prisma } from "@/lib/prisma";
import { normalizeCode } from "./normalizeCode";
import { resolveRegistrantGroupPhotoName } from "./registrantDisplayName";
import { TagMatchSource } from "@/generated/prisma/enums";

export type TagMatchMaps = {
  registrantByCode: Map<string, { id: string; name: string }>;
  referenceByCode: Map<string, { name: string }>;
};

export type TagMatch = { name: string; registrantId: string | null; matchSource: TagMatchSource };

/**
 * One source of truth for "what registrant/legacy-reference does this code currently belong to",
 * shared by every place that needs it: the bulk auto-sync passes (autoSyncGroupPhotoTags,
 * syncRegistrantGroupPhotoTags), the admin dialog save, and the public/share-link edit actions.
 * Fetches the university's whole registrant/reference set — same "small enough to hold in memory"
 * scale assumption already used everywhere else group-photo matching happens (`Registrant.data`
 * isn't indexed for this, per the project's established normalization strategy).
 */
export async function buildTagMatchMaps(universityId: string): Promise<TagMatchMaps> {
  const [registrantRows, referenceRows] = await Promise.all([
    prisma.registrant.findMany({
      where: { universityId },
      select: { id: true, displayName: true, data: true },
    }),
    prisma.groupPhotoLegacyReference.findMany({
      where: { universityId },
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
