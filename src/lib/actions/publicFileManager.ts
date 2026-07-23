"use server";

import { prisma } from "@/lib/prisma";
import { isPcPhotoServerConfigured, mintPcPhotoServerToken } from "@/lib/pcPhotoServer";
import { isPathWithinScope } from "@/lib/fileManager/pathScope";
import { computeCollisionSafeName } from "@/lib/fileManager/collisionSafeName";
import type { FmEntry } from "@/lib/actions/fileManager";

/**
 * Token-authenticated, NOT session-authenticated — mirrors the `photo-review`/`register/[slug]`
 * precedent (the URL token IS the credential). Never import requireSession/requireUniversityAccess
 * here. Every function re-validates any client-supplied sub-path against the share's own `path`
 * via `isPathWithinScope` before ever calling the PC server — an anonymous visitor's requests are
 * never trusted at face value, unlike the admin actions in `fileManager.ts`.
 */

async function resolveActiveLink(token: string) {
  const link = await prisma.fileManagerShareLink.findUnique({ where: { token } });
  if (!link || !link.isActive) return null;
  return link;
}

export type PublicShareInfo = { path: string; isFolder: boolean; name: string };

export async function getShareLinkInfo(token: string): Promise<PublicShareInfo | null> {
  const link = await resolveActiveLink(token);
  if (!link) return null;
  return { path: link.path, isFolder: link.isFolder, name: link.path.split("/").pop() ?? link.path };
}

/** Full-access call to the PC server, minted+consumed entirely server-side — never exposed to the
 * anonymous visitor's browser. Kept separate from fileManager.ts's identical-looking helper so this
 * file visibly never imports a session-gating function. */
async function callPcServerPublic(
  method: "GET" | "POST",
  routePath: string,
  opts: { query?: Record<string, string> } = {},
): Promise<unknown> {
  if (!isPcPhotoServerConfigured()) throw new Error("ยังไม่ได้ตั้งค่า PC Server");
  const { baseUrl, token } = mintPcPhotoServerToken();
  const qs = opts.query ? `?${new URLSearchParams(opts.query).toString()}` : "";
  const resp = await fetch(`${baseUrl}${routePath}${qs}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((body as { error?: string }).error || `PC server ${routePath} failed (${resp.status})`);
  return body;
}

export async function listSharedFolder(
  token: string,
  subPath?: string,
): Promise<{ entries: FmEntry[]; path: string } | null> {
  const link = await resolveActiveLink(token);
  if (!link || !link.isFolder) return null;

  const targetPath = subPath && subPath.trim() ? subPath : link.path;
  if (!isPathWithinScope(targetPath, link.path)) return null;

  const result = (await callPcServerPublic("GET", "/fm/list", { query: { path: targetPath } })) as {
    entries: FmEntry[];
  };
  return { entries: result.entries, path: targetPath };
}

/** Returns the direct, already-public PC-server URL for one file within the share — never a token,
 * since GET /photos/* has always been unauthenticated (same trust model as a Vercel Blob URL). */
export async function getDownloadUrl(token: string, filePath: string): Promise<string | null> {
  const link = await resolveActiveLink(token);
  if (!link) return null;

  const target = link.isFolder ? filePath : link.path;
  if (link.isFolder) {
    if (!isPathWithinScope(target, link.path)) return null;
  } else if (target !== link.path) {
    return null;
  }
  if (!isPcPhotoServerConfigured()) return null;

  const baseUrl = process.env.NEXT_PUBLIC_PC_PHOTO_STORAGE_URL!.replace(/\/+$/, "");
  return `${baseUrl}/photos/${target}`;
}

export type PublicUploadTarget = { uploadUrl: string; token: string; finalPath: string; finalName: string };

/**
 * Folder shares only — always targets the share's OWN top-level path, never a client-supplied
 * sub-path, so an anonymous visitor can only ever drop files at the one "dropbox" location they
 * were given, not into any subfolder they merely browsed into. Mints a token scoped + `uploadOnly`
 * to that exact final path — see mintPcPhotoServerToken's own doc comment for why this is mandatory
 * for any token handed to a browser, especially an anonymous one.
 */
export async function getPublicUploadTarget(token: string, fileName: string): Promise<PublicUploadTarget | null> {
  const link = await resolveActiveLink(token);
  if (!link || !link.isFolder) return null;
  if (!fileName) return null;

  const listing = (await callPcServerPublic("GET", "/fm/list", { query: { path: link.path } })) as {
    entries: FmEntry[];
  };
  const finalName = computeCollisionSafeName(
    listing.entries.filter((e) => !e.isDir).map((e) => e.name),
    fileName,
  );
  const finalPath = `${link.path}/${finalName}`;

  if (!isPcPhotoServerConfigured()) return null;
  const { baseUrl, token: uploadToken } = mintPcPhotoServerToken({ scope: finalPath, uploadOnly: true });
  return { uploadUrl: `${baseUrl}/upload`, token: uploadToken, finalPath, finalName };
}
