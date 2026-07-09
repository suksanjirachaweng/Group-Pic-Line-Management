import { TagMatchSource } from "@/generated/prisma/enums";

export type TagForValidation = {
  id: string;
  normalizedCode: string;
  matchSource: TagMatchSource;
};

export type TagProblem =
  | { type: "DUPLICATE_CODE"; normalizedCode: string; tagIds: string[] }
  | { type: "UNMATCHED_CODE"; tagId: string };

/**
 * Pure function reused by the in-canvas live flagging, the dedicated validate report/export
 * gate, and the public share-link's row selection — one implementation, three consumers, so
 * they can't drift apart.
 */
export function validateTags(tags: TagForValidation[]): TagProblem[] {
  const problems: TagProblem[] = [];

  const byCode = new Map<string, string[]>();
  for (const tag of tags) {
    if (!tag.normalizedCode) continue;
    const existing = byCode.get(tag.normalizedCode);
    if (existing) existing.push(tag.id);
    else byCode.set(tag.normalizedCode, [tag.id]);
  }
  for (const [normalizedCode, tagIds] of byCode) {
    if (tagIds.length > 1) problems.push({ type: "DUPLICATE_CODE", normalizedCode, tagIds });
  }

  for (const tag of tags) {
    if (tag.matchSource === TagMatchSource.MANUAL) {
      problems.push({ type: "UNMATCHED_CODE", tagId: tag.id });
    }
  }

  return problems;
}

/** Tag IDs referenced by any problem — the set of tags eligible for problem-case follow-up. */
export function problemTagIds(problems: TagProblem[]): Set<string> {
  const ids = new Set<string>();
  for (const p of problems) {
    if (p.type === "DUPLICATE_CODE") p.tagIds.forEach((id) => ids.add(id));
    else ids.add(p.tagId);
  }
  return ids;
}
