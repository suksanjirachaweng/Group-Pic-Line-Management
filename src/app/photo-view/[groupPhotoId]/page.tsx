import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { buildLiffRegisterUrl } from "@/lib/liffUrl";
import { normalizeCode } from "@/lib/groupPhoto/normalizeCode";
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

  let ownTag = tag ? photo.tags.find((t) => t.id === tag) : undefined;

  // The tag id in the URL is a snapshot from whenever this link was generated/sent — if the
  // registrant has since corrected their own group_photo_index in LINE, `ownTag` is now wherever
  // they *used* to be tagged, not where they current belong. Re-resolve against their live code
  // (rather than the tag's stored registrantId, which nothing keeps in sync in real time) so a
  // months-old LINE message still lands on the right spot.
  if (ownTag?.registrantId) {
    const registrant = await prisma.registrant.findUnique({
      where: { id: ownTag.registrantId },
      select: { data: true },
    });
    const rawCode = (registrant?.data as Record<string, unknown> | null)?.group_photo_index;
    const currentCode = typeof rawCode === "string" ? normalizeCode(rawCode) : "";
    if (currentCode && currentCode !== ownTag.normalizedCode) {
      const rematched = photo.tags.find((t) => t.normalizedCode === currentCode);
      if (rematched) ownTag = rematched;
    }
  }

  const initialTagId = ownTag ? ownTag.id : null;

  // Resolves a link back to the graduate's own registration edit screen (for when the tagged
  // name/code is wrong because THEY mistyped it, not because of a mis-OCR/mis-tag) — only
  // possible when this tag is actually matched to a live registrant with a resolvable LIFF app.
  let editLiffUrl: string | null = null;
  if (ownTag?.registrantId) {
    const registrant = await prisma.registrant.findUnique({
      where: { id: ownTag.registrantId },
      select: { channel: { select: { liffId: true } } },
    });
    const university = await prisma.university.findUnique({
      where: { id: photo.universityId },
      select: { slug: true },
    });
    if (registrant?.channel?.liffId && university?.slug) {
      editLiffUrl = buildLiffRegisterUrl(registrant.channel.liffId, university.slug);
    }
  }

  return (
    <PhotoViewClient
      groupPhotoId={photo.id}
      photoName={photo.title?.trim() || photo.name}
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
      editLiffUrl={editLiffUrl}
      initialReportedProblem={ownTag?.reportedProblem ?? false}
    />
  );
}
