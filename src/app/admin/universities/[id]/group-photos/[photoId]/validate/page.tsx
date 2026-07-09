import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, canAccessUniversity } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validateTags } from "@/lib/groupPhoto/validateTags";
import { ProblemActionsPanel } from "./ProblemActionsPanel";

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

  const problems = validateTags(photo.tags);
  const duplicateGroups = problems.filter((p) => p.type === "DUPLICATE_CODE");
  const unmatchedIds = new Set(problems.filter((p) => p.type === "UNMATCHED_CODE").map((p) => p.tagId));
  const unmatchedTags = photo.tags.filter((t) => unmatchedIds.has(t.id));
  const tagsById = new Map(photo.tags.map((t) => [t.id, t]));
  const problemTagIdSet = new Set(problems.flatMap((p) => (p.type === "DUPLICATE_CODE" ? p.tagIds : [p.tagId])));
  const problemTags = photo.tags
    .filter((t) => problemTagIdSet.has(t.id))
    .map((t) => ({
      id: t.id,
      name: t.name,
      code: t.code,
      canDirectMessage: !!(t.registrantId && t.registrant?.lineUserId && t.registrant?.channelId),
    }));

  return (
    <div className="mx-auto max-w-2xl p-6">
      <Link
        href={`/admin/universities/${universityId}/group-photos/${photoId}`}
        className="text-sm text-gray-500 hover:text-gray-700"
      >
        ← กลับไปแท็ก
      </Link>
      <h1 className="mb-1 mt-2 text-lg font-semibold text-gray-900">{photo.name} — ตรวจสอบความถูกต้อง</h1>
      <p className="mb-4 text-sm text-gray-600">แท็กแล้ว {photo.tags.length} คน</p>

      <div className="mb-4 flex gap-2">
        <a
          href={`/api/admin/universities/${universityId}/group-photos/${photoId}/export/excel`}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Export Excel (.xlsx)
        </a>
        <a
          href={`/api/admin/universities/${universityId}/group-photos/${photoId}/export/text`}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Export ข้อความ (.txt)
        </a>
      </div>

      {problems.length === 0 ? (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
          ไม่พบปัญหา — ข้อมูลพร้อม export
        </p>
      ) : (
        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          พบ {problems.length} รายการที่อาจต้องตรวจสอบก่อน export (ยัง export ได้ตามปกติ)
        </p>
      )}

      {duplicateGroups.length > 0 && (
        <div className="mb-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">เลขซ้ำในรูปเดียวกัน ({duplicateGroups.length})</h2>
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
            {duplicateGroups.map((g) =>
              g.type === "DUPLICATE_CODE" ? (
                <li key={g.normalizedCode} className="px-4 py-2 text-sm">
                  <span className="font-mono text-red-600">{g.normalizedCode}</span> —{" "}
                  {g.tagIds
                    .map((id) => tagsById.get(id))
                    .filter(Boolean)
                    .map((t) => `${t!.name} (แถว ${t!.row} ลำดับ ${t!.order})`)
                    .join(", ")}
                </li>
              ) : null,
            )}
          </ul>
        </div>
      )}

      {unmatchedTags.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">ไม่พบในระบบลงทะเบียน/ไฟล์อ้างอิง ({unmatchedTags.length})</h2>
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
            {unmatchedTags.map((t) => (
              <li key={t.id} className="px-4 py-2 text-sm">
                <span className="font-mono text-amber-600">{t.code}</span> — {t.name} (แถว {t.row} ลำดับ {t.order})
              </li>
            ))}
          </ul>
        </div>
      )}

      {problemTags.length > 0 && (
        <ProblemActionsPanel universityId={universityId} groupPhotoId={photoId} problemTags={problemTags} />
      )}
    </div>
  );
}
