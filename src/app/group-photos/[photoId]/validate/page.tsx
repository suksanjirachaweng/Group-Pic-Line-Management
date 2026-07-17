import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PublicValidateView } from "./PublicValidateView";

/**
 * Public counterpart of the old admin-only /admin/.../validate page — deliberately no session
 * check, so this link can be forwarded to non-admin reviewers (e.g. faculty staff) without
 * needing an account. Allows quick tag code/name fixes and renaming the display title, but no
 * messaging (that stays admin-gated on the tagging page itself). Scoped by photoId alone
 * since it doesn't need a university-scoped admin session to resolve access. No live
 * registrant/reference matching needed here — each tag's stored `matchSource` (set at
 * tagging/import time) is all validateTags() needs.
 */
export default async function PublicValidateGroupPhotoPage({
  params,
}: {
  params: Promise<{ photoId: string }>;
}) {
  const { photoId } = await params;

  const photo = await prisma.groupPhoto.findUnique({
    where: { id: photoId },
    include: {
      tags: { orderBy: [{ row: "asc" }, { order: "asc" }] },
    },
  });
  if (!photo) notFound();

  const initialTags = photo.tags.map((t) => ({
    id: t.id,
    code: t.code,
    normalizedCode: t.normalizedCode,
    name: t.name,
    row: t.row,
    order: t.order,
    x: t.x,
    y: t.y,
    matchSource: t.matchSource,
    editedViaPublicLink: t.editedViaPublicLink,
    confirmedViaPublicLink: t.confirmedViaPublicLink,
    problemAcknowledged: t.problemAcknowledged,
  }));

  return (
    <PublicValidateView
      photoId={photo.id}
      photoName={photo.name}
      photoTitle={photo.title}
      imageUrl={photo.imageUrl}
      imageWidth={photo.imageWidth}
      imageHeight={photo.imageHeight}
      initialTags={initialTags}
    />
  );
}
