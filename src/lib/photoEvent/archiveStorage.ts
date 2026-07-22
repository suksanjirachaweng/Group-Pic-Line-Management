import "server-only";
import { put, list, del } from "@vercel/blob";
import { isPcPhotoServerConfigured, mintPcPhotoServerToken } from "@/lib/pcPhotoServer";
import type { PhotoEventArchiveBundle } from "./archiveTypes";

/** Archives follow the same backend switch as live GroupPhoto images (see uploadLargePhoto.ts):
 * the self-hosted PC server when configured, Vercel Blob otherwise. Deliberately reuses the live
 * switch rather than always pinning archives to Vercel Blob — keeping close-out backups on Vercel
 * Blob while the PC server carries all the live traffic would defeat the point of moving storage
 * off Vercel, since a full event's images are exactly what close-out archives.
 *
 * uploadToPcServer always passes ?exact=1 (see pc-photo-server/server.js) so the PC server writes
 * to (and overwrites) the exact deterministic path requested, matching Vercel Blob's
 * `addRandomSuffix:false, allowOverwrite:true` — required because archivedImageRelativePath below
 * is computed and written into data.json *before* the actual image bytes are uploaded, so the
 * real file has to land at that exact same path or reimportEventArchive.ts's relative-URL lookup
 * 404s. See isPcPhotoServerReachable's use in startPhotoEventArchive for the up-front "PC is off"
 * guard this backend needs that Vercel Blob never did. */
function archivePrefix(photoEventId: string): string {
  return `archives/${photoEventId}`;
}

export function archiveDataJsonPath(photoEventId: string): string {
  return `${archivePrefix(photoEventId)}/data.json`;
}

export function archiveImagePath(photoEventId: string, groupPhotoId: string, ext: string): string {
  return `${archivePrefix(photoEventId)}/images/${groupPhotoId}.${ext}`;
}

/** Server-to-server upload to the PC server's /upload — the cron route already holds the full
 * body in memory (bundle JSON string, or an image buffer fetched from the live URL below), so
 * this always sends a plain string/Buffer body rather than a stream, sidestepping Node fetch's
 * duplex-mode requirement for streamed request bodies entirely. */
async function uploadToPcServer(relativePath: string, body: string | Buffer, contentType: string): Promise<string> {
  const { baseUrl, token } = mintPcPhotoServerToken();
  const resp = await fetch(`${baseUrl}/upload?path=${encodeURIComponent(relativePath)}&exact=1`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body: typeof body === "string" ? body : new Uint8Array(body),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`PC server upload failed (${resp.status})${detail ? `: ${detail}` : ""}`);
  }
  const { url } = (await resp.json()) as { url: string };
  return url;
}

export async function uploadArchiveDataJson(
  photoEventId: string,
  bundle: PhotoEventArchiveBundle,
): Promise<string> {
  const path = archiveDataJsonPath(photoEventId);
  const json = JSON.stringify(bundle, null, 2);

  if (isPcPhotoServerConfigured()) {
    return uploadToPcServer(path, json, "application/json");
  }

  const blob = await put(path, json, {
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

/** Copies the live image's bytes straight into its permanent archive path — works for any live
 * backend since imageUrl is always just a plain, fetchable public URL. */
export async function copyImageToArchive(
  photoEventId: string,
  groupPhotoId: string,
  liveImageUrl: string,
): Promise<string> {
  const resp = await fetch(liveImageUrl);
  if (!resp.ok || !resp.body) throw new Error(`Failed to fetch live image (${resp.status})`);
  const ext = extensionFromUrl(liveImageUrl);
  const path = archiveImagePath(photoEventId, groupPhotoId, ext);
  const contentType = resp.headers.get("content-type") ?? guessContentType(ext);

  if (isPcPhotoServerConfigured()) {
    const buf = Buffer.from(await resp.arrayBuffer());
    return uploadToPcServer(path, buf, contentType);
  }

  const blob = await put(path, resp.body, {
    access: "public",
    contentType,
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

function isVercelBlobUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

/** Permanently deletes every file under an event's archives/<eventId> prefix — the data.json
 * manifest and every copied image, on whichever backend this *particular* event's archive
 * actually lives on (an old event may still be on Vercel Blob even if the PC server is
 * configured now — inferred from archiveFileUrl's own host, not the current global switch).
 * Irreversible; callers must have already confirmed with the operator (see
 * permanentlyDeletePhotoEventArchive, which requires typing the event code). */
export async function deleteArchiveFiles(photoEventId: string, archiveFileUrl: string): Promise<void> {
  const prefix = archivePrefix(photoEventId);
  if (isVercelBlobUrl(archiveFileUrl)) {
    let cursor: string | undefined;
    do {
      const result = await list({ prefix, cursor, limit: 1000 });
      if (result.blobs.length > 0) {
        await del(result.blobs.map((b) => b.url));
      }
      cursor = result.hasMore ? result.cursor : undefined;
    } while (cursor);
    return;
  }

  const { baseUrl, token } = mintPcPhotoServerToken();
  const resp = await fetch(`${baseUrl}/files?path=${encodeURIComponent(prefix)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`PC server delete failed (${resp.status})${detail ? `: ${detail}` : ""}`);
  }
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
