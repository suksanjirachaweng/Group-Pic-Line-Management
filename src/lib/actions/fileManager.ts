"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/authz";
import { getAppBaseUrl } from "@/lib/appUrl";
import { isPcPhotoServerConfigured, isPcPhotoServerReachable, mintPcPhotoServerToken } from "@/lib/pcPhotoServer";
import { FM_ROOT, isValidFmPath } from "@/lib/fileManager/pathScope";
import { computeCollisionSafeName } from "@/lib/fileManager/collisionSafeName";

/**
 * Standalone, general-purpose file manager (Phase 5) — completely unrelated to the group-photo
 * registration domain. Files/folders live entirely on the self-hosted PC server's `filemanager/`
 * subtree; this app stores NO mirror of the file tree (see FileManagerShareLink's own schema
 * comment for why) — every list/mkdir/rename/move/delete below is a live round-trip to the PC
 * server. Any logged-in admin (either role) can use this — there is no per-university scoping and
 * no additional role gate beyond `requireSession()`.
 *
 * Every function validates its own path arguments against `isValidFmPath` before ever calling out
 * to the PC server, even though these are all admin-trusted server actions — cheap, and keeps this
 * feature's one new attack surface (a real filesystem, not just DB rows) consistently guarded.
 */

export type FmEntry = { name: string; isDir: boolean; size: number; mtimeMs: number };

function assertConfigured() {
  if (!isPcPhotoServerConfigured()) {
    throw new Error("ยังไม่ได้ตั้งค่า PC Server (ดูตัวแปรแวดล้อม NEXT_PUBLIC_PC_PHOTO_STORAGE_URL / PC_PHOTO_STORAGE_SECRET)");
  }
}

function assertValidPath(p: string) {
  if (!isValidFmPath(p)) throw new Error("พาธไม่ถูกต้อง");
}

/** Full-access (never sent to a browser) call to the PC server — mints its own unscoped token
 * fresh per call, matching the existing embedFace()/archive-job convention. */
async function callPcServer(
  method: "GET" | "POST" | "DELETE",
  routePath: string,
  opts: { query?: Record<string, string>; jsonBody?: unknown; timeoutMs?: number } = {},
): Promise<unknown> {
  assertConfigured();
  const { baseUrl, token } = mintPcPhotoServerToken();
  const qs = opts.query ? `?${new URLSearchParams(opts.query).toString()}` : "";
  const url = `${baseUrl}${routePath}${qs}`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(opts.jsonBody !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.jsonBody !== undefined ? JSON.stringify(opts.jsonBody) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error("PC server ไม่ตอบสนอง (เครื่องอาจปิดอยู่หรือไม่ได้เชื่อมต่ออินเทอร์เน็ต)");
    }
    throw err;
  }
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error((body as { error?: string }).error || `PC server ${routePath} failed (${resp.status})`);
  }
  return body;
}

export async function isFileManagerReachable(): Promise<boolean> {
  await requireSession();
  return isPcPhotoServerReachable();
}

export async function listFolder(path: string = FM_ROOT): Promise<FmEntry[]> {
  await requireSession();
  assertValidPath(path);
  const result = (await callPcServer("GET", "/fm/list", { query: { path } })) as { entries: FmEntry[] };
  return result.entries;
}

export async function createFolder(parentPath: string, name: string): Promise<void> {
  await requireSession();
  assertValidPath(parentPath);
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
    throw new Error("ชื่อโฟลเดอร์ไม่ถูกต้อง");
  }
  await callPcServer("POST", "/fm/mkdir", { jsonBody: { path: `${parentPath}/${name}` } });
  revalidatePath("/admin/file-manager", "layout");
}

/**
 * There's no DB mirror of the file tree (see the module doc comment), so a `FileManagerShareLink`
 * has no stable ID to hang onto — its `path` column IS the identity, snapshotted at share-creation
 * time. Without this, renaming/moving a shared file leaves the share pointing at a path that no
 * longer exists: the public page still renders (it only checks `isActive`), but the download link
 * silently 404s. Shifting every share whose path is the renamed/moved entry itself, or lives nested
 * under it (a shared subfolder inside a renamed parent), keeps existing links working instead of
 * quietly breaking them.
 */
async function shiftShareLinkPaths(oldPath: string, newPath: string): Promise<void> {
  const affected = await prisma.fileManagerShareLink.findMany({
    where: { OR: [{ path: oldPath }, { path: { startsWith: `${oldPath}/` } }] },
  });
  for (const link of affected) {
    const suffix = link.path.slice(oldPath.length); // "" for the entry itself, "/sub/..." if nested
    await prisma.fileManagerShareLink.update({ where: { id: link.id }, data: { path: `${newPath}${suffix}` } });
  }
}

export async function renameEntry(path: string, newName: string): Promise<void> {
  await requireSession();
  assertValidPath(path);
  if (path === FM_ROOT) throw new Error("ไม่สามารถเปลี่ยนชื่อโฟลเดอร์หลักได้");
  if (!newName || newName.includes("/") || newName.includes("\\") || newName.includes("..")) {
    throw new Error("ชื่อใหม่ไม่ถูกต้อง");
  }
  await callPcServer("POST", "/fm/rename", { jsonBody: { path, newName } });
  const parent = path.split("/").slice(0, -1).join("/");
  await shiftShareLinkPaths(path, `${parent}/${newName}`);
  revalidatePath("/admin/file-manager", "layout");
}

export async function moveEntry(path: string, newParentPath: string): Promise<void> {
  await requireSession();
  assertValidPath(path);
  assertValidPath(newParentPath);
  if (path === FM_ROOT) throw new Error("ไม่สามารถย้ายโฟลเดอร์หลักได้");
  await callPcServer("POST", "/fm/move", { jsonBody: { path, newParentPath } });
  const name = path.split("/").pop()!;
  await shiftShareLinkPaths(path, `${newParentPath}/${name}`);
  revalidatePath("/admin/file-manager", "layout");
}

export async function deleteEntry(path: string): Promise<void> {
  await requireSession();
  assertValidPath(path);
  if (path === FM_ROOT) throw new Error("ไม่สามารถลบโฟลเดอร์หลักได้");
  await callPcServer("DELETE", "/files", { query: { path } });
  revalidatePath("/admin/file-manager", "layout");
}

export async function getDiskSpace(): Promise<{ free: number; size: number }> {
  await requireSession();
  return (await callPcServer("GET", "/fm/disk-space")) as { free: number; size: number };
}

export type UploadTarget = { uploadUrl: string; token: string; finalPath: string; finalName: string };

/**
 * Computes a collision-safe final filename (via a fresh `list` of the destination folder) and
 * mints a token SCOPED to exactly this one destination path, marked `uploadOnly` — mandatory, not
 * just for anonymous share uploads, since there's no reason an admin's browser needs a token valid
 * for anything beyond the one file it's about to upload. The browser then uploads directly to the
 * PC server with this token (bypassing Vercel's serverless body-size limit for large files) — see
 * `UploadButton.tsx`.
 */
export async function getUploadTarget(parentPath: string, fileName: string): Promise<UploadTarget> {
  await requireSession();
  assertValidPath(parentPath);
  if (!fileName) throw new Error("ไม่มีชื่อไฟล์");

  const existing = await listFolder(parentPath);
  const finalName = computeCollisionSafeName(
    existing.filter((e) => !e.isDir).map((e) => e.name),
    fileName,
  );
  const finalPath = `${parentPath}/${finalName}`;

  assertConfigured();
  const { baseUrl, token } = mintPcPhotoServerToken({ scope: finalPath, uploadOnly: true });
  return { uploadUrl: `${baseUrl}/upload`, token, finalPath, finalName };
}

export type ShareLinkInfo = { id: string; url: string; isFolder: boolean; createdAt: string };

/** Idempotent: reuses an existing active share link for this exact path rather than creating a
 * new one on every click, mirroring `createGroupPhotoShareLink`'s established behavior. */
export async function createShareLink(path: string, isFolder: boolean): Promise<ShareLinkInfo> {
  await requireSession();
  assertValidPath(path);

  const existing = await prisma.fileManagerShareLink.findFirst({
    where: { path, isFolder, isActive: true },
    orderBy: { createdAt: "desc" },
  });
  const link =
    existing ??
    (await prisma.fileManagerShareLink.create({
      data: { path, isFolder, token: randomBytes(24).toString("base64url") },
    }));
  return {
    id: link.id,
    url: `${getAppBaseUrl()}/files/${link.token}`,
    isFolder: link.isFolder,
    createdAt: link.createdAt.toISOString(),
  };
}

export async function listShareLinks(path: string): Promise<ShareLinkInfo[]> {
  await requireSession();
  assertValidPath(path);
  const links = await prisma.fileManagerShareLink.findMany({
    where: { path, isActive: true },
    orderBy: { createdAt: "desc" },
  });
  return links.map((link) => ({
    id: link.id,
    url: `${getAppBaseUrl()}/files/${link.token}`,
    isFolder: link.isFolder,
    createdAt: link.createdAt.toISOString(),
  }));
}

export async function deactivateShareLink(id: string): Promise<void> {
  await requireSession();
  await prisma.fileManagerShareLink.update({ where: { id }, data: { isActive: false } });
  revalidatePath("/admin/file-manager", "layout");
}
