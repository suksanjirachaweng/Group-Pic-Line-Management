// Shared path helpers for the standalone file manager (Phase 5) — every admin/public action must
// route through these rather than trusting a client-supplied path directly, since this feature's
// entire attack surface (unlike the rest of the app) is "can a caller make the PC server touch a
// file it shouldn't." Mirrors (and must be hand-kept in sync with) the equivalent checks in
// pc-photo-server/server.js — that's a separate CommonJS project with no shared import boundary.

export const FM_ROOT = "filemanager";

/**
 * Boundary-aware prefix check — `scope="filemanager/foo"` must NOT match `"filemanager/foo-evil"`,
 * only `"filemanager/foo"` itself or anything under `"filemanager/foo/"`. Also rejects any
 * candidate containing a literal `..` component outright — a naive prefix check alone would
 * happily accept `"filemanager/foo/../secret"` as "within" `"filemanager/foo"` (the string does
 * start with that prefix) even though resolving the `..` could walk it somewhere else entirely.
 * This is the load-bearing check for the public share pages (which folder-tree a client-supplied
 * sub-path is allowed to touch) — always use this rather than a raw `startsWith` on untrusted input.
 */
export function isPathWithinScope(candidate: string, scope: string): boolean {
  if (candidate.includes("..")) return false;
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const c = norm(candidate);
  const s = norm(scope);
  return c === s || c.startsWith(s + "/");
}

/** Joins path segments under FM_ROOT, rejecting anything that could escape it. Every segment must
 * be non-empty, contain no `..`, and contain no `/`/`\` of its own (a single path COMPONENT, not a
 * sub-path) — callers that already have a real relative path (e.g. from a `list` result) should
 * validate it with `isPathWithinScope`/`isValidFmPath` instead of trying to re-split it here. */
export function joinFmPath(...segments: string[]): string {
  for (const seg of segments) {
    if (!seg || seg.includes("..") || seg.includes("/") || seg.includes("\\")) {
      throw new Error(`Invalid path segment: ${seg}`);
    }
  }
  return [FM_ROOT, ...segments].join("/");
}

/** True if `candidate` is a syntactically safe path under FM_ROOT — no `..`, not absolute, and
 * either equal to FM_ROOT itself or nested under it. Does NOT check the path actually exists. */
export function isValidFmPath(candidate: string): boolean {
  if (!candidate || candidate.includes("..") || candidate.startsWith("/") || candidate.includes("\\")) return false;
  return candidate === FM_ROOT || candidate.startsWith(FM_ROOT + "/");
}

/**
 * Encodes a `/`-joined path for use in a `/photos/...` URL, one segment at a time — never
 * `encodeURIComponent` on the whole string (that would also escape the `/` separators). Building
 * these URLs by directly interpolating a raw path/name into a template string is NOT safe: it
 * relies on the browser's own href/src normalization to encode spaces/Unicode, which breaks the
 * moment a segment contains a literal `%` (e.g. a name like `%E0%B8...` — a real case hit once,
 * caused by a since-fixed bug elsewhere that let a raw percent-encoded string become an actual
 * folder name on disk) — a literal `%` left un-escaped gets misread as the start of an escape
 * sequence, silently 404ing. Encoding every segment explicitly is correct for both the ordinary
 * case (Thai text, spaces) and this pathological one.
 */
export function encodePathForUrl(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
