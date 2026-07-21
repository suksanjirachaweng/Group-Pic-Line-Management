import { prisma } from "@/lib/prisma";
import { validateTags } from "@/lib/groupPhoto/validateTags";
import { PhotoReviewView } from "./PhotoReviewView";

// This page uses only `params` (no cookies/headers/searchParams), which Next.js would otherwise
// treat as eligible for the Full Route Cache — meaning the FIRST visit to a given token gets
// frozen and served to every later visit until something calls revalidatePath for this exact
// path. Tag matches change constantly (registration auto-sync, admin edits) independent of any
// action taken on this page itself, so a cached render can show a stale name (e.g. "ยังไม่มีชื่อ")
// even after the DB is correct — confirmed 2026-07-21: a tag matched via registration showed
// unmatched here until an unrelated edit's own revalidatePath call happened to bust the cache.
export const dynamic = "force-dynamic";

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
