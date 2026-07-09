import { prisma } from "@/lib/prisma";
import { validateTags } from "@/lib/groupPhoto/validateTags";
import { PhotoReviewView } from "./PhotoReviewView";

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
  const problemTagIds = new Set(problems.flatMap((p) => (p.type === "DUPLICATE_CODE" ? p.tagIds : [p.tagId])));

  return (
    <PhotoReviewView
      token={token}
      photoName={photo.name}
      imageUrl={photo.imageUrl}
      imageWidth={photo.imageWidth}
      imageHeight={photo.imageHeight}
      tags={photo.tags}
      problemTagIds={problemTagIds}
    />
  );
}
