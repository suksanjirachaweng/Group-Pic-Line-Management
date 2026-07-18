import "server-only";
import { put } from "@vercel/blob";
import type { PhotoEventArchiveBundle } from "./archiveTypes";

/** Archives always live on Vercel Blob under this prefix, regardless of which backend the live
 * GroupPhoto images currently use (Vercel Blob or the self-hosted PC server) — one consistent,
 * durable location independent of the operator's live-storage choice, so an archived event stays
 * retrievable even if the PC server is later decommissioned. */
function archivePrefix(photoEventId: string): string {
  return `archives/${photoEventId}`;
}

export function archiveDataJsonPath(photoEventId: string): string {
  return `${archivePrefix(photoEventId)}/data.json`;
}

export function archiveImagePath(photoEventId: string, groupPhotoId: string, ext: string): string {
  return `${archivePrefix(photoEventId)}/images/${groupPhotoId}.${ext}`;
}

export async function uploadArchiveDataJson(
  photoEventId: string,
  bundle: PhotoEventArchiveBundle,
): Promise<string> {
  const blob = await put(archiveDataJsonPath(photoEventId), JSON.stringify(bundle, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    // Re-archiving the same event (e.g. after a reimport, or retrying a failed job) must refresh
    // the manifest at its same canonical path rather than erroring — the path is deterministic by
    // design so archiveFileUrl never has to change.
    allowOverwrite: true,
  });
  return blob.url;
}

/** Streams the live image's bytes straight into its permanent archive path — works for any live
 * backend since imageUrl is always just a plain, fetchable public URL. */
export async function copyImageToArchive(
  photoEventId: string,
  groupPhotoId: string,
  liveImageUrl: string,
): Promise<string> {
  const resp = await fetch(liveImageUrl);
  if (!resp.ok || !resp.body) throw new Error(`Failed to fetch live image (${resp.status})`);
  const ext = extensionFromUrl(liveImageUrl);
  const blob = await put(archiveImagePath(photoEventId, groupPhotoId, ext), resp.body, {
    access: "public",
    contentType: resp.headers.get("content-type") ?? guessContentType(ext),
    addRandomSuffix: false,
    // Same idempotency reasoning as uploadArchiveDataJson — a retried tick after a partial
    // failure must be able to re-copy the same photo to the same path without erroring.
    allowOverwrite: true,
  });
  return blob.url;
}

export async function fetchArchiveDataJson(dataJsonUrl: string): Promise<PhotoEventArchiveBundle> {
  const resp = await fetch(dataJsonUrl);
  if (!resp.ok) throw new Error(`Failed to fetch archive manifest (${resp.status})`);
  return (await resp.json()) as PhotoEventArchiveBundle;
}

function extensionFromUrl(url: string): string {
  const path = new URL(url).pathname;
  const match = /\.([a-zA-Z0-9]+)$/.exec(path);
  return match ? match[1].toLowerCase() : "jpg";
}

function guessContentType(ext: string): string {
  switch (ext) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return "image/jpeg";
  }
}
