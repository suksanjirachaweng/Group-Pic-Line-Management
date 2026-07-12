import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, canAccessUniversity } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeCode } from "@/lib/groupPhoto/normalizeCode";
import { TagCanvas } from "./TagCanvas";
import { UpdatePhotoImageButton } from "./UpdatePhotoImageButton";
import { ImportMarkFileButton } from "./ImportMarkFileButton";
import { PhotoStatusSelector } from "./PhotoStatusSelector";
import { PhotoTitleEditor } from "./PhotoTitleEditor";
import type { RegistrantLookup, ReferenceLookup } from "./TagEditDialog";
import { autoSyncGroupPhotoTags } from "@/lib/actions/groupPhotos";

export default async function GroupPhotoTaggingPage({
  params,
}: {
  params: Promise<{ id: string; photoId: string }>;
}) {
  const { id: universityId, photoId } = await params;

  const session = await getServerSession(authOptions);
  const user = session!.user;
  if (!canAccessUniversity(user, universityId)) notFound();

  // Pick up any registrant/reference data that changed since this photo was last tagged (e.g.
  // someone fixed their group_photo_index in LINE) before rendering, as long as the photo isn't
  // marked done yet — see the function's own comment for why DONE freezes this.
  await autoSyncGroupPhotoTags(universityId, photoId);

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
    // AdminChrome hides the shared header/padding for this route (see FULLSCREEN_PATTERN), so
    // this can just claim the full viewport directly instead of subtracting that chrome's size.
    <div className="flex h-dvh flex-col">
      <div className="border-b border-gray-200 bg-white px-4 py-2.5">
        <div className="flex items-stretch gap-3">
          {/* Left column: back+logo above the import buttons, both flush against the same
              left edge — kept as one flex-col instead of two independently-flexed rows so
              the two rows can't drift apart (each row used to right/center-align its own
              group independently, which left everything a few px off between rows). */}
          <div className="flex shrink-0 flex-col justify-center gap-1.5">
            <div className="flex items-center gap-2">
              <Link
                href={`/admin/universities/${universityId}/group-photos`}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                ← กลับ
              </Link>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/nsl-logo.png" alt="Newsalon" className="h-6 w-auto" />
            </div>
            <div className="flex items-center gap-2">
              <UpdatePhotoImageButton universityId={universityId} groupPhotoId={photo.id} />
              <ImportMarkFileButton universityId={universityId} groupPhotoId={photo.id} />
            </div>
          </div>

          {/* Center column: just the title block (with its own edit button + subtitle) — the
              status selector now lives in the right cluster instead, next to Export/Share. */}
          <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1.5">
            <PhotoTitleEditor universityId={universityId} groupPhotoId={photo.id} name={photo.name} title={photo.title} />
          </div>

          {/* Right column: status selector, then Export Excel/text stacked flush-left against
              each other, Share stretched to the full header height beside them. */}
          <div className="flex shrink-0 items-stretch gap-2">
            <div className="flex flex-col justify-center">
              <PhotoStatusSelector universityId={universityId} groupPhotoId={photo.id} status={photo.status} />
            </div>
            <div className="flex flex-col justify-center gap-1.5">
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
            </div>
            <Link
              href={`/group-photos/${photo.id}/validate`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center rounded-md bg-indigo-600 px-3 text-xs font-medium text-white hover:bg-indigo-700"
            >
              Share
            </Link>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1">
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
