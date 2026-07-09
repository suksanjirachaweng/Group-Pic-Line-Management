import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, canAccessUniversity } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UploadGroupPhotoButton } from "./UploadGroupPhotoButton";
import { DeleteGroupPhotoButton } from "./DeleteGroupPhotoButton";

export default async function GroupPhotosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: universityId } = await params;

  const session = await getServerSession(authOptions);
  const user = session!.user;
  if (!canAccessUniversity(user, universityId)) notFound();

  const university = await prisma.university.findUnique({ where: { id: universityId } });
  if (!university) notFound();

  const photos = await prisma.groupPhoto.findMany({
    where: { universityId },
    orderBy: { sortOrder: "asc" },
    include: { _count: { select: { tags: true } } },
  });

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{university.name} — รูปหมู่</h1>
          <Link
            href={`/admin/universities/${universityId}/group-photos/legacy-reference`}
            className="text-xs text-indigo-600 hover:underline"
          >
            จัดการรายชื่ออ้างอิงเก่า (Google Form)
          </Link>
        </div>
        <UploadGroupPhotoButton universityId={universityId} />
      </div>

      {photos.length === 0 ? (
        <p className="text-sm text-gray-400">ยังไม่มีรูปหมู่ — อัปโหลดรูปแรกได้เลย</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {photos.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-4 py-3">
              <Link
                href={`/admin/universities/${universityId}/group-photos/${p.id}`}
                className="text-sm text-gray-900 hover:text-indigo-600 hover:underline"
              >
                {p.name}
              </Link>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400">{p._count.tags} คน</span>
                <DeleteGroupPhotoButton universityId={universityId} groupPhotoId={p.id} photoName={p.name} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
