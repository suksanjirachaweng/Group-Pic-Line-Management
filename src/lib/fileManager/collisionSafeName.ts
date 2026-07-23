/**
 * Given the names already present in a folder and a desired filename, returns the first name that
 * doesn't collide — `"report.pdf"`, then `"report (1).pdf"`, `"report (2).pdf"`, etc. File-manager
 * uploads preserve the caller's real filename (unlike group photos, which get a random suffix), so
 * collisions are expected and should read like a normal file-explorer "copy" naming convention, not
 * an error.
 */
export function computeCollisionSafeName(existingNames: string[], desiredName: string): string {
  const existing = new Set(existingNames);
  if (!existing.has(desiredName)) return desiredName;

  const dotIndex = desiredName.lastIndexOf(".");
  const hasExt = dotIndex > 0; // dotIndex === 0 means a dotfile like ".env", not an extension
  const base = hasExt ? desiredName.slice(0, dotIndex) : desiredName;
  const ext = hasExt ? desiredName.slice(dotIndex) : "";

  let n = 1;
  let candidate = `${base} (${n})${ext}`;
  while (existing.has(candidate)) {
    n += 1;
    candidate = `${base} (${n})${ext}`;
  }
  return candidate;
}
