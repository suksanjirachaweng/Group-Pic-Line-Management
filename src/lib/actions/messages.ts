"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUniversityAccess } from "@/lib/authz";
import { interpolateTemplate } from "@/lib/rules/evaluate";
import { uploadImage } from "@/lib/blob";

export type BulkSendState = { success: true; count: number } | { success: false; error: string } | null;

/**
 * Queues a MessageJob for each selected registrant (source=MANUAL), same pipeline as the
 * per-registrant manual send and rule-triggered sends. Registrants without a bound LINE
 * channel/user id are silently skipped (they never completed registration, so there's nothing
 * to push to).
 */
export async function sendBulkMessage(
  universityId: string,
  _prevState: BulkSendState,
  formData: FormData,
): Promise<BulkSendState> {
  await requireUniversityAccess(universityId);

  const registrantIds = formData.getAll("registrantIds").map(String);
  const body = String(formData.get("body") ?? "").trim();
  const linkUrl = String(formData.get("link") ?? "").trim() || null;
  if (registrantIds.length === 0) return { success: false, error: "ยังไม่ได้เลือกผู้รับ" };

  let imageUrl: string | null = null;
  const imageFile = formData.get("image");
  if (imageFile instanceof File && imageFile.size > 0) {
    try {
      imageUrl = await uploadImage(imageFile, `universities/${universityId}/broadcasts`);
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : "อัปโหลดรูปไม่สำเร็จ" };
    }
  } else {
    // No newly-picked file — reuse an already-uploaded URL carried over from a loaded template.
    imageUrl = String(formData.get("imageUrl") ?? "").trim() || null;
  }

  if (!body && !imageUrl) return { success: false, error: "กรุณากรอกข้อความ หรือแนบรูปอย่างน้อย 1 อย่าง" };
  if (linkUrl && !imageUrl) return { success: false, error: "ใส่ลิงก์ได้ต้องแนบรูปด้วย (ลิงก์จะเปิดเมื่อกดที่รูป)" };

  const registrants = await prisma.registrant.findMany({
    where: { id: { in: registrantIds }, universityId, lineUserId: { not: null }, channelId: { not: null } },
  });

  if (registrants.length === 0) {
    return { success: false, error: "ไม่มีผู้รับที่ส่งข้อความได้ในกลุ่มที่เลือก (ต้องลงทะเบียนผูก LINE แล้ว)" };
  }

  await prisma.messageJob.createMany({
    data: registrants.map((r) => ({
      registrantId: r.id,
      channelId: r.channelId!,
      source: "MANUAL" as const,
      body: body ? interpolateTemplate(body, { displayName: r.displayName, data: (r.data ?? {}) as Record<string, unknown> }) : "",
      imageUrl,
      linkUrl,
    })),
  });

  revalidatePath(`/admin/universities/${universityId}/registrants`);
  return { success: true, count: registrants.length };
}
