import "server-only";
import { del } from "@vercel/blob";
import { mintPcPhotoServerToken } from "@/lib/pcPhotoServer";

function isVercelBlobUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

/** A live GroupPhoto.imageUrl can point directly at its own archive copy after a reimport (see
 * reimportEventArchive.ts, which reuses the archived image instead of re-uploading a duplicate) —
 * deleting that would destroy the actual backup, not just an orphaned live file, so this is
 * checked before every delete attempt below regardless of backend. */
function isArchivedCopyUrl(url: string): boolean {
  try {
    return new URL(url).pathname.includes("/archives/");
  } catch {
    return false;
  }
}

/** Maps a PC-server-hosted image URL back to the relative path pc-photo-server's own /files
 * DELETE endpoint expects — only if the URL's origin actually matches the currently-configured
 * PC server (guards against attempting a delete against a stale URL from a since-reconfigured
 * server, however unlikely in practice). */
function pcServerRelativePath(url: string): string | null {
  const baseUrl = process.env.NEXT_PUBLIC_PC_PHOTO_STORAGE_URL;
  if (!baseUrl) return null;
  try {
    const target = new URL(url);
    if (target.origin !== new URL(baseUrl).origin) return null;
    const marker = "/photos/";
    const idx = target.pathname.indexOf(marker);
    if (idx === -1) return null;
    return decodeURIComponent(target.pathname.slice(idx + marker.length));
  } catch {
    return null;
  }
}

/** Deletes one live (never-archived) GroupPhoto image file — current or a past
 * GroupPhotoImageHistory version — from whichever backend it actually lives on. Best-effort: a
 * storage-cleanup miss is logged, never thrown, since callers always call this after the DB row
 * that referenced it is already gone, and there's nothing left to roll back to. */
export async function deleteLiveGroupPhotoImage(url: string): Promise<void> {
  if (isArchivedCopyUrl(url)) return;

  try {
    if (isVercelBlobUrl(url)) {
      await del(url);
      return;
    }

    const relativePath = pcServerRelativePath(url);
    if (!relativePath) return;
    const { baseUrl, token } = mintPcPhotoServerToken();
    const resp = await fetch(`${baseUrl}/files?path=${encodeURIComponent(relativePath)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      throw new Error(`PC server delete failed (${resp.status})`);
    }
  } catch (err) {
    console.error(`Failed to delete live group-photo image ${url}:`, err);
  }
}
