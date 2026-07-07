"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUniversityAccess } from "@/lib/authz";
import { uploadImage, deleteImage } from "@/lib/blob";
import { AdminRole } from "@/generated/prisma/enums";

export type ImageActionState = { error: string } | { success: true } | null;

/**
 * Images can now be reused across universities/fields (see listImageLibrary), so a URL may be
 * referenced by more than one row — only delete the underlying blob once nothing points at it
 * anymore, checked after the row that's being replaced/cleared has already been updated.
 */
async function deleteImageIfUnreferenced(url: string): Promise<void> {
  const [universityCount, fieldCount] = await Promise.all([
    prisma.university.count({ where: { headerImageUrl: url } }),
    prisma.formFieldDefinition.count({ where: { imageUrl: url } }),
  ]);
  if (universityCount + fieldCount === 0) {
    await deleteImage(url).catch(() => {});
  }
}

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
      await deleteImageIfUnreferenced(existing.headerImageUrl);
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Upload failed" };
  }

  revalidatePath(`/admin/universities/${universityId}`);
  revalidatePath(`/admin/universities/${universityId}/preview`);
  return { success: true };
}

/** Sets the header image to an already-uploaded URL picked from the shared library — no re-upload. */
export async function selectUniversityHeaderImage(
  universityId: string,
  url: string,
): Promise<ImageActionState> {
  await requireUniversityAccess(universityId);

  const existing = await prisma.university.findUnique({ where: { id: universityId } });
  await prisma.university.update({ where: { id: universityId }, data: { headerImageUrl: url } });

  if (existing?.headerImageUrl && existing.headerImageUrl !== url) {
    await deleteImageIfUnreferenced(existing.headerImageUrl);
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
    await deleteImageIfUnreferenced(existing.headerImageUrl);
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
      await deleteImageIfUnreferenced(existing.imageUrl);
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Upload failed" };
  }

  revalidatePath(`/admin/universities/${universityId}`);
  revalidatePath(`/admin/universities/${universityId}/preview`);
  return { success: true };
}

/** Sets a form field's example image to an already-uploaded URL picked from the shared library. */
export async function selectFormFieldImage(
  universityId: string,
  fieldId: string,
  url: string,
): Promise<ImageActionState> {
  await requireUniversityAccess(universityId);

  const existing = await prisma.formFieldDefinition.findUnique({ where: { id: fieldId, universityId } });
  await prisma.formFieldDefinition.update({ where: { id: fieldId, universityId }, data: { imageUrl: url } });

  if (existing?.imageUrl && existing.imageUrl !== url) {
    await deleteImageIfUnreferenced(existing.imageUrl);
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
    await deleteImageIfUnreferenced(existing.imageUrl);
  }

  revalidatePath(`/admin/universities/${universityId}`);
  revalidatePath(`/admin/universities/${universityId}/preview`);
}

export type LibraryImage = { url: string; label: string };

/**
 * Lists every image URL already in use (header images + field example images) that this admin
 * can see — scoped to their assigned universities, or all of them for a superadmin — so a
 * common image (e.g. a standard example photo) can be reused instead of re-uploaded every time.
 */
export async function listImageLibrary(universityId: string): Promise<LibraryImage[]> {
  const session = await requireUniversityAccess(universityId);

  const universityFilter =
    session.user.role === AdminRole.SUPERADMIN ? {} : { id: { in: session.user.universityIds } };

  const universities = await prisma.university.findMany({
    where: { ...universityFilter, headerImageUrl: { not: null } },
    select: { name: true, headerImageUrl: true },
  });
  const fields = await prisma.formFieldDefinition.findMany({
    where: { university: universityFilter, imageUrl: { not: null } },
    select: { label: true, imageUrl: true, university: { select: { name: true } } },
  });

  const byUrl = new Map<string, string>();
  for (const u of universities) {
    if (u.headerImageUrl) byUrl.set(u.headerImageUrl, `${u.name} (header)`);
  }
  for (const f of fields) {
    if (f.imageUrl && !byUrl.has(f.imageUrl)) byUrl.set(f.imageUrl, `${f.university.name} — ${f.label}`);
  }

  return Array.from(byUrl, ([url, label]) => ({ url, label }));
}
