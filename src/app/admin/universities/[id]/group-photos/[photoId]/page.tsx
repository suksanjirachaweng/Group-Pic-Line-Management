import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, canAccessUniversity } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeCode } from "@/lib/groupPhoto/normalizeCode";
import { TagCanvas } from "./TagCanvas";
import { UpdatePhotoImageButton } from "./UpdatePhotoImageButton";
import { ImportMarkFileButton } from "./ImportMarkFileButton";
import type { RegistrantLookup, ReferenceLookup } from "./TagEditDialog";

export default async function GroupPhotoTaggingPage({
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
    include: { tags: { orderBy: [{ row: "asc" }, { order: "asc" }] } },
  });
  if (!photo) notFound();

  const [registrantRows, referenceRows] = await Promise.all([
    prisma.registrant.findMany({
      where: { universityId },
      select: { id: true, displayName: true, lineUserId: true, channelId: true, data: true },
    }),
    prisma.groupPhotoLegacyReference.findMany({
      where: { universityId },
      select: { name: true, normalizedCode: true, source: true },
    }),
  ]);

  const registrants: RegistrantLookup[] = registrantRows
    .map((r) => {
      const data = (r.data ?? {}) as Record<string, unknown>;
      const rawCode = data.group_photo_index;
      if (typeof rawCode !== "string" || !rawCode.trim()) return null;
      const normalizedCode = normalizeCode(rawCode);
      if (!normalizedCode) return null;
      return {
        id: r.id,
        name: r.displayName ?? "(ไม่มีชื่อ)",
        normalizedCode,
        hasLine: !!(r.lineUserId && r.channelId),
      };
    })
    .filter((r): r is RegistrantLookup => r !== null);

  const legacyReferences: ReferenceLookup[] = referenceRows;

  return (
    <div className="flex h-screen flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-white px-4 py-2.5">
        <Link href={`/admin/universities/${universityId}/group-photos`} className="text-sm text-gray-500 hover:text-gray-700">
          ← กลับ
        </Link>
        <h1 className="text-sm font-semibold text-gray-900">{photo.name}</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <UpdatePhotoImageButton universityId={universityId} groupPhotoId={photo.id} />
          <ImportMarkFileButton universityId={universityId} groupPhotoId={photo.id} />
          <div className="h-5 w-px bg-gray-200" />
          <a
            href={`/api/group-photos/${photo.id}/export/excel`}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Export Excel
          </a>
          <a
            href={`/api/group-photos/${photo.id}/export/text`}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Export ข้อความ
          </a>
          <Link
            href={`/group-photos/${photo.id}/validate`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
          >
            Share
          </Link>
        </div>
      </div>
      <div className="flex-1">
        <TagCanvas
          universityId={universityId}
          groupPhotoId={photo.id}
          imageUrl={photo.imageUrl}
          imageWidth={photo.imageWidth}
          imageHeight={photo.imageHeight}
          initialTags={photo.tags}
          registrants={registrants}
          legacyReferences={legacyReferences}
        />
      </div>
    </div>
  );
}
