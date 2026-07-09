import { prisma } from "@/lib/prisma";
import { validateTags } from "@/lib/groupPhoto/validateTags";
import { PhotoReviewTagForm } from "./PhotoReviewTagForm";

export default async function PhotoReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const link = await prisma.groupPhotoShareLink.findUnique({ where: { token } });
  if (!link || !link.isActive) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          ลิงก์นี้ไม่ถูกต้องหรือถูกปิดใช้งานแล้ว กรุณาติดต่อผู้ดูแลเพื่อขอลิงก์ใหม่
        </p>
      </div>
    );
  }

  const photo = await prisma.groupPhoto.findUnique({
    where: { id: link.groupPhotoId },
    include: { tags: { orderBy: [{ row: "asc" }, { order: "asc" }] } },
  });
  if (!photo) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">ไม่พบรูปนี้แล้ว</p>
      </div>
    );
  }

  const problems = validateTags(photo.tags);
  const problemIds = new Set(problems.flatMap((p) => (p.type === "DUPLICATE_CODE" ? p.tagIds : [p.tagId])));
  const problemTags = photo.tags.filter((t) => problemIds.has(t.id));

  return (
    <div className="mx-auto max-w-lg p-6">
      <h1 className="mb-1 text-lg font-semibold text-gray-900">{photo.name} — ช่วยตรวจสอบรายชื่อ</h1>
      <p className="mb-4 text-sm text-gray-600">
        รบกวนตรวจสอบและแก้ไขหมายเลข/ชื่อของคนต่อไปนี้ให้ถูกต้อง ({problemTags.length} คน)
      </p>

      {problemTags.length === 0 ? (
        <p className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-700">ไม่มีรายการที่ต้องแก้ไขแล้ว — ขอบคุณครับ</p>
      ) : (
        <div className="flex flex-col gap-3">
          {problemTags.map((t) => (
            <PhotoReviewTagForm key={t.id} token={token} tag={t} />
          ))}
        </div>
      )}
    </div>
  );
}
