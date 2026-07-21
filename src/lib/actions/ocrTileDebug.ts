"use server";

import { prisma } from "@/lib/prisma";
import { requireUniversityAccess } from "@/lib/authz";
import { deleteImage } from "@/lib/blob";
import type { CardOcrHit } from "@/lib/actions/bulkCardOcr";

export type SavedOcrTile = {
  id: string;
  tileIndex: number;
  left: number;
  top: number;
  width: number;
  height: number;
  uploadWidth: number;
  uploadHeight: number;
  imageUrl: string;
  hits: CardOcrHit[];
  failed: boolean;
  createdAt: string;
};

/** Persisted OCR tile count for a photo — cheap enough to load alongside the rest of the page's
 * server-side data, so the "view saved OCR tiles" button can show a count without a client fetch. */
export async function countOcrTiles(universityId: string, groupPhotoId: string): Promise<number> {
  await requireUniversityAccess(universityId);
  return prisma.groupPhotoOcrTile.count({ where: { groupPhotoId } });
}

export async function listOcrTiles(universityId: string, groupPhotoId: string): Promise<SavedOcrTile[]> {
  await requireUniversityAccess(universityId);
  const rows = await prisma.groupPhotoOcrTile.findMany({
    where: { groupPhotoId },
    orderBy: [{ tileIndex: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    tileIndex: r.tileIndex,
    left: r.left,
    top: r.top,
    width: r.width,
    height: r.height,
    uploadWidth: r.uploadWidth,
    uploadHeight: r.uploadHeight,
    imageUrl: r.imageUrl,
    hits: r.hits as CardOcrHit[],
    failed: r.failed,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * Clears every persisted OCR tile record for this photo — the explicit "I'm done verifying, throw
 * it away" action these records exist to wait for (never auto-deleted otherwise, see the schema
 * doc comment on GroupPhotoOcrTile). Deletes the DB rows first, then best-effort cleans up the
 * actual Blob files — a failed blob delete shouldn't leave the DB rows stuck undeletable.
 */
export async function deleteOcrTiles(universityId: string, groupPhotoId: string): Promise<{ deleted: number }> {
  await requireUniversityAccess(universityId);
  const rows = await prisma.groupPhotoOcrTile.findMany({
    where: { groupPhotoId },
    select: { id: true, imageUrl: true },
  });
  await prisma.groupPhotoOcrTile.deleteMany({ where: { groupPhotoId } });

  for (const r of rows) {
    if (!r.imageUrl) continue;
    try {
      await deleteImage(r.imageUrl);
    } catch (err) {
      console.error("Failed to delete OCR tile blob:", r.imageUrl, err);
    }
  }

  return { deleted: rows.length };
}
