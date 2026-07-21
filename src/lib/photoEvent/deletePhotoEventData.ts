import "server-only";
import { del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { PhotoEventStatus } from "@/generated/prisma/enums";

/** True for a live GroupPhoto.imageUrl that's actually pointing at its own archive copy (happens
 * after a reimport — see reimportEventArchive.ts, which reuses the archived image directly instead
 * of re-uploading a duplicate). Deleting that blob here would destroy the archive itself on a
 * second close-out cycle, so those are always left alone. */
function isArchivedCopyUrl(url: string): boolean {
  try {
    return new URL(url).pathname.includes("/archives/");
  } catch {
    return false;
  }
}

function isVercelBlobUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

/** The destructive half of close-out: deletes every live row scoped to this PhotoEvent (Registrant
 * first, since its photoEventId FK is SetNull not Cascade — everything else cascades from
 * GroupPhoto/GroupPhotoLegacyReference's own required, Cascade-on-delete photoEventId). The
 * PhotoEvent row itself is deliberately NEVER deleted — it's the permanent index entry pointing at
 * the archive, and reimportEventArchive.ts recreates children back into this same row. Only
 * callable once an archive has actually finished (status=ARCHIVE_READY); flips status to ARCHIVED
 * on success. */
export async function deletePhotoEventData(photoEventId: string): Promise<{ deletedRegistrants: number; deletedGroupPhotos: number }> {
  const event = await prisma.photoEvent.findUniqueOrThrow({ where: { id: photoEventId } });
  if (event.status !== PhotoEventStatus.ARCHIVE_READY) {
    throw new Error("ต้องสำรองข้อมูลให้เสร็จก่อน (สถานะ ARCHIVE_READY) จึงจะลบข้อมูลได้");
  }

  const photos = await prisma.groupPhoto.findMany({
    where: { photoEventId },
    select: { imageUrl: true },
  });

  const [deletedRegistrants] = await prisma.$transaction([
    prisma.registrant.deleteMany({ where: { photoEventId } }),
    prisma.groupPhoto.deleteMany({ where: { photoEventId } }),
    prisma.groupPhotoLegacyReference.deleteMany({ where: { photoEventId } }),
  ]).then(([r]) => [r.count]);

  await prisma.photoEvent.update({
    where: { id: photoEventId },
    data: { status: PhotoEventStatus.ARCHIVED, hiddenFromLiff: true },
  });

  // Best-effort — a failed blob delete shouldn't undo the DB cleanup that already succeeded above.
  for (const p of photos) {
    if (isArchivedCopyUrl(p.imageUrl) || !isVercelBlobUrl(p.imageUrl)) continue;
    try {
      await del(p.imageUrl);
    } catch (err) {
      console.error(`Failed to delete live image blob after archiving photoEvent ${photoEventId}:`, err);
    }
  }

  return { deletedRegistrants, deletedGroupPhotos: photos.length };
}
