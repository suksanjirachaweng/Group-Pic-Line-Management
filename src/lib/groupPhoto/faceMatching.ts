/** Shared by facultyFaceSearch.ts (search from an existing tag's photo point) and
 * facultyFaceBank.ts (search from an admin-uploaded image) — same ranking math, two different
 * sources for the query embedding. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
