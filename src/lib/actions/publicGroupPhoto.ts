"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { normalizeCode } from "@/lib/groupPhoto/normalizeCode";

export type PublicUpdateState = { error: string } | { success: true } | null;

/**
 * Token-authenticated, NOT session-authenticated — mirrors the register/[slug] precedent (the
 * URL segment is the credential). Never import requireSession/requireUniversityAccess here.
 */
export async function updateTagViaPublicLink(
  token: string,
  tagId: string,
  _prevState: PublicUpdateState,
  formData: FormData,
): Promise<PublicUpdateState> {
  const link = await prisma.groupPhotoShareLink.findUnique({ where: { token } });
  if (!link || !link.isActive) return { error: "ลิงก์นี้ไม่ถูกต้องหรือถูกปิดใช้งานแล้ว" };

  const tag = await prisma.groupPhotoTag.findUnique({ where: { id: tagId } });
  if (!tag || tag.groupPhotoId !== link.groupPhotoId) {
    return { error: "ไม่พบข้อมูลนี้ในรูปที่ลิงก์นี้เกี่ยวข้อง" };
  }

  const name = String(formData.get("name") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim();
  if (!code) return { error: "กรุณากรอกหมายเลข" };

  await prisma.groupPhotoTag.update({
    where: { id: tagId },
    data: {
      name,
      code,
      normalizedCode: normalizeCode(code),
      editedViaPublicLink: true,
      publicLinkEditedAt: new Date(),
    },
  });

  revalidatePath(`/photo-review/${token}`);
  return { success: true };
}

/**
 * Same no-session, URL-is-the-credential model as updateTagViaPublicLink above, but keyed on the
 * group photo id directly rather than a share-link token — this backs the double-click edit
 * dialog on the public /group-photos/[photoId]/validate page, which anyone holding that link can
 * already view and export from (explicit product decision: whoever has the link can also fix a
 * mis-OCR'd code or missing name right there, not just admins).
 */
export async function updateGroupPhotoTagViaValidatePage(
  photoId: string,
  tagId: string,
  _prevState: PublicUpdateState,
  formData: FormData,
): Promise<PublicUpdateState> {
  const tag = await prisma.groupPhotoTag.findUnique({ where: { id: tagId } });
  if (!tag || tag.groupPhotoId !== photoId) {
    return { error: "ไม่พบข้อมูลนี้ในรูปนี้" };
  }

  const name = String(formData.get("name") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim();
  if (!code) return { error: "กรุณากรอกหมายเลข" };

  await prisma.groupPhotoTag.update({
    where: { id: tagId },
    data: {
      name,
      code,
      normalizedCode: normalizeCode(code),
      editedViaPublicLink: true,
      publicLinkEditedAt: new Date(),
    },
  });

  revalidatePath(`/group-photos/${photoId}/validate`);
  return { success: true };
}
