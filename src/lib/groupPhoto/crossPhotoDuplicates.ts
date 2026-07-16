export type TagSourceLabel = "LINE" | "Excel" | "Google Sheet" | "กรอกเอง";

export type TagForCrossPhotoCheck = {
  id: string;
  groupPhotoId: string;
  groupPhotoName: string;
  code: string;
  name: string;
  normalizedCode: string;
  source: TagSourceLabel;
};

export type CrossPhotoDuplicateEntry = {
  key: string;
  matches: TagForCrossPhotoCheck[];
};

/**
 * A tag's own photo can have its own duplicate-code problem already (see validateTags.ts) — this
 * is a different, university-wide check: the same code or name tagged in MORE THAN ONE DIFFERENT
 * photo. Not necessarily a mistake (one person can legitimately appear in more than one photo),
 * but worth surfacing so an admin can double-check it was intentional.
 */
export function findCrossPhotoDuplicatesByCode(tags: TagForCrossPhotoCheck[]): CrossPhotoDuplicateEntry[] {
  const byCode = new Map<string, TagForCrossPhotoCheck[]>();
  for (const tag of tags) {
    if (!tag.normalizedCode) continue;
    const existing = byCode.get(tag.normalizedCode);
    if (existing) existing.push(tag);
    else byCode.set(tag.normalizedCode, [tag]);
  }
  const result: CrossPhotoDuplicateEntry[] = [];
  for (const [code, matches] of byCode) {
    if (new Set(matches.map((m) => m.groupPhotoId)).size > 1) {
      result.push({ key: code, matches });
    }
  }
  return result;
}

export function findCrossPhotoDuplicatesByName(tags: TagForCrossPhotoCheck[]): CrossPhotoDuplicateEntry[] {
  const byName = new Map<string, TagForCrossPhotoCheck[]>();
  for (const tag of tags) {
    const normalized = tag.name.trim().toLowerCase();
    if (!normalized) continue;
    const existing = byName.get(normalized);
    if (existing) existing.push(tag);
    else byName.set(normalized, [tag]);
  }
  const result: CrossPhotoDuplicateEntry[] = [];
  for (const [name, matches] of byName) {
    if (new Set(matches.map((m) => m.groupPhotoId)).size > 1) {
      result.push({ key: name, matches });
    }
  }
  return result;
}

export type DuplicateKind = "code" | "name";

export type MergedDuplicateGroup = {
  key: string;
  kinds: DuplicateKind[];
  matches: TagForCrossPhotoCheck[];
};

/**
 * A code-duplicate group and a name-duplicate group are usually the exact same set of tags (the
 * same real person, code and name both consistent everywhere they were tagged) — merges those
 * into one row instead of showing the same set of photos twice in two separate tables.
 */
export function mergeCrossPhotoDuplicates(
  codeDuplicates: CrossPhotoDuplicateEntry[],
  nameDuplicates: CrossPhotoDuplicateEntry[],
): MergedDuplicateGroup[] {
  function tagSetKey(entry: CrossPhotoDuplicateEntry): string {
    return entry.matches
      .map((m) => m.id)
      .sort()
      .join(",");
  }

  const byTagSetKey = new Map<string, MergedDuplicateGroup>();
  for (const entry of codeDuplicates) {
    byTagSetKey.set(tagSetKey(entry), { key: entry.key, kinds: ["code"], matches: entry.matches });
  }
  for (const entry of nameDuplicates) {
    const setKey = tagSetKey(entry);
    const existing = byTagSetKey.get(setKey);
    if (existing) existing.kinds.push("name");
    else byTagSetKey.set(setKey, { key: entry.key, kinds: ["name"], matches: entry.matches });
  }
  return [...byTagSetKey.values()];
}
