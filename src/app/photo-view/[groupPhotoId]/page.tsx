import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PhotoViewClient } from "./PhotoViewClient";

/**
 * Public, read-only viewer — a registrant's "just registered" screen links here so they can zoom
 * straight to their own position in an already-tagged group photo. No token beyond the photo's
 * own (unguessable) id and their tag's id, mirroring the public /photo-review/[token] posture.
 */
export default async function PhotoViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupPhotoId: string }>;
  searchParams: Promise<{ tag?: string }>;
}) {
  const { groupPhotoId } = await params;
  const { tag } = await searchParams;

  const photo = await prisma.groupPhoto.findUnique({
    where: { id: groupPhotoId },
    include: { tags: { orderBy: [{ row: "asc" }, { order: "asc" }] } },
  });
  if (!photo) notFound();

  const initialTagId = tag && photo.tags.some((t) => t.id === tag) ? tag : null;

  return (
    <PhotoViewClient
      photoName={photo.name}
      imageUrl={photo.imageUrl}
      imageWidth={photo.imageWidth}
      imageHeight={photo.imageHeight}
      tags={photo.tags.map((t) => ({
        id: t.id,
        code: t.code,
        name: t.name,
        row: t.row,
        order: t.order,
        x: t.x,
        y: t.y,
      }))}
      initialTagId={initialTagId}
    />
  );
}
