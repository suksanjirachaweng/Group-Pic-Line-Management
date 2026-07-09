import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, canAccessUniversity } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeCode } from "@/lib/groupPhoto/normalizeCode";
import { ValidateView } from "./ValidateView";

export default async function ValidateGroupPhotoPage({
  params,
}: {
  params: Promise<{ id: string; photoId: string }>;
}) {
  const { id: universityId, photoId } = await params;

  const session = await getServerSession(authOptions);
  const user = session!.user;
  if (!canAccessUniversity(user, universityId)) notFound();

  const photo = await prisma.groupPhoto.findUnique({
    where: { id: photoId, universityId },
    include: {
      tags: {
        orderBy: [{ row: "asc" }, { order: "asc" }],
        include: { registrant: { select: { lineUserId: true, channelId: true } } },
      },
    },
  });
  if (!photo) notFound();

  const [registrantRows, referenceRows] = await Promise.all([
    prisma.registrant.findMany({
      where: { universityId },
      select: { id: true, data: true },
    }),
    prisma.groupPhotoLegacyReference.findMany({
      where: { universityId },
      select: { normalizedCode: true },
    }),
  ]);

  const registrantByCode = new Map<string, { id: string }>();
  for (const r of registrantRows) {
    const data = (r.data ?? {}) as Record<string, unknown>;
    const rawCode = data.group_photo_index;
    if (typeof rawCode !== "string" || !rawCode.trim()) continue;
    const normalized = normalizeCode(rawCode);
    if (normalized) registrantByCode.set(normalized, { id: r.id });
  }
  const referenceByCode = new Set(referenceRows.map((r) => r.normalizedCode));

  const initialTags = photo.tags.map((t) => ({
    id: t.id,
    code: t.code,
    normalizedCode: t.normalizedCode,
    name: t.name,
    row: t.row,
    order: t.order,
    x: t.x,
    y: t.y,
    registrantId: t.registrantId,
    matchSource: t.matchSource,
    registrantLineUserId: t.registrant?.lineUserId ?? null,
    registrantChannelId: t.registrant?.channelId ?? null,
  }));

  return (
    <ValidateView
      universityId={universityId}
      photoId={photoId}
      photoName={photo.name}
      imageUrl={photo.imageUrl}
      imageWidth={photo.imageWidth}
      imageHeight={photo.imageHeight}
      initialTags={initialTags}
      registrantByCode={registrantByCode}
      referenceByCode={referenceByCode}
    />
  );
}
