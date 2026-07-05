"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUniversityAccess } from "@/lib/authz";
import { uploadImage, deleteImage } from "@/lib/blob";

export type ImageActionState = { error: string } | { success: true } | null;

export async function uploadUniversityHeaderImage(
  universityId: string,
  _prevState: ImageActionState,
  formData: FormData,
): Promise<ImageActionState> {
  await requireUniversityAccess(universityId);

  const file = formData.get("headerImage");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "No file selected" };
  }

  try {
    const existing = await prisma.university.findUnique({ where: { id: universityId } });
    const url = await uploadImage(file, `universities/${universityId}/header`);

    await prisma.university.update({ where: { id: universityId }, data: { headerImageUrl: url } });

    if (existing?.headerImageUrl) {
      await deleteImage(existing.headerImageUrl).catch(() => {});
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Upload failed" };
  }

  revalidatePath(`/admin/universities/${universityId}`);
  revalidatePath(`/admin/universities/${universityId}/preview`);
  return { success: true };
}

export async function removeUniversityHeaderImage(universityId: string) {
  await requireUniversityAccess(universityId);

  const existing = await prisma.university.findUnique({ where: { id: universityId } });
  await prisma.university.update({ where: { id: universityId }, data: { headerImageUrl: null } });

  if (existing?.headerImageUrl) {
    await deleteImage(existing.headerImageUrl).catch(() => {});
  }

  revalidatePath(`/admin/universities/${universityId}`);
  revalidatePath(`/admin/universities/${universityId}/preview`);
}

export async function uploadFormFieldImage(
  universityId: string,
  fieldId: string,
  _prevState: ImageActionState,
  formData: FormData,
): Promise<ImageActionState> {
  await requireUniversityAccess(universityId);

  const file = formData.get("fieldImage");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "No file selected" };
  }

  try {
    const existing = await prisma.formFieldDefinition.findUnique({ where: { id: fieldId, universityId } });
    const url = await uploadImage(file, `universities/${universityId}/fields/${fieldId}`);

    await prisma.formFieldDefinition.update({ where: { id: fieldId, universityId }, data: { imageUrl: url } });

    if (existing?.imageUrl) {
      await deleteImage(existing.imageUrl).catch(() => {});
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Upload failed" };
  }

  revalidatePath(`/admin/universities/${universityId}`);
  revalidatePath(`/admin/universities/${universityId}/preview`);
  return { success: true };
}

export async function removeFormFieldImage(universityId: string, fieldId: string) {
  await requireUniversityAccess(universityId);

  const existing = await prisma.formFieldDefinition.findUnique({ where: { id: fieldId, universityId } });
  await prisma.formFieldDefinition.update({ where: { id: fieldId, universityId }, data: { imageUrl: null } });

  if (existing?.imageUrl) {
    await deleteImage(existing.imageUrl).catch(() => {});
  }

  revalidatePath(`/admin/universities/${universityId}`);
  revalidatePath(`/admin/universities/${universityId}/preview`);
}
