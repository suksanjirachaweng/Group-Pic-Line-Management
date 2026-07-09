"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUniversityAccess } from "@/lib/authz";
import { uploadImage } from "@/lib/blob";

export type TemplateActionState = { error: string } | { success: true } | null;

export type MessageTemplateSummary = {
  id: string;
  name: string;
  body: string;
  imageUrl: string | null;
  linkUrl: string | null;
};

export async function listMessageTemplates(universityId: string): Promise<MessageTemplateSummary[]> {
  await requireUniversityAccess(universityId);
  return prisma.messageTemplate.findMany({
    where: { universityId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, body: true, imageUrl: true, linkUrl: true },
  });
}

/**
 * Saving under an existing name overwrites that template. If a new image file is attached it's
 * uploaded and stored as a permanent URL; if the caller instead passes along an already-known
 * `imageUrl` (e.g. loaded from another template without picking a new file), that URL is reused
 * as-is with no re-upload.
 */
export async function saveMessageTemplate(
  universityId: string,
  formData: FormData,
): Promise<TemplateActionState> {
  await requireUniversityAccess(universityId);

  const name = String(formData.get("name") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const linkUrl = String(formData.get("link") ?? "").trim() || null;
  if (!name) return { error: "ตั้งชื่อ template ก่อน" };

  let imageUrl = String(formData.get("imageUrl") ?? "").trim() || null;
  const imageFile = formData.get("image");
  if (imageFile instanceof File && imageFile.size > 0) {
    try {
      imageUrl = await uploadImage(imageFile, `universities/${universityId}/templates`);
    } catch (err) {
      return { error: err instanceof Error ? err.message : "อัปโหลดรูปไม่สำเร็จ" };
    }
  }

  if (!body && !imageUrl) return { error: "กรอกข้อความ หรือแนบรูปอย่างน้อย 1 อย่าง" };

  await prisma.messageTemplate.upsert({
    where: { universityId_name: { universityId, name } },
    create: { universityId, name, body, imageUrl, linkUrl },
    update: { body, imageUrl, linkUrl },
  });

  revalidatePath(`/admin/universities/${universityId}/registrants`);
  return { success: true };
}

export async function deleteMessageTemplate(universityId: string, templateId: string): Promise<void> {
  await requireUniversityAccess(universityId);
  await prisma.messageTemplate.delete({ where: { id: templateId, universityId } });
  revalidatePath(`/admin/universities/${universityId}/registrants`);
}
