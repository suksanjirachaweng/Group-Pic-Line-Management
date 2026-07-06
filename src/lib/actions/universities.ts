"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSuperadmin, requireUniversityAccess } from "@/lib/authz";
import { FormFieldType } from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";

const universitySchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[a-z0-9-]+$/,
      "Slug must be lowercase letters, numbers, and hyphens only",
    ),
  name: z.string().min(1).max(200),
  themeColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Theme color must be a hex color like #4f46e5")
    .optional(),
});

/**
 * Default registration form fields seeded on every new university, mirroring the original
 * Google Form ("ชื่อ-นามสกุล" / "หมายเลขถ่ายภาพหมู่" / "หมายเลขโทรศัพท์"). These are just a
 * starting point — the admin can add or delete fields per university afterward.
 */
const DEFAULT_FORM_FIELDS = [
  {
    key: "full_name",
    label: "ชื่อ-นามสกุล / Full Name",
    description:
      "ระบุคำนำหน้าชื่อ เช่น รศ.ดร. หากมี\n(สำหรับคณะนานาชาติ ให้กรอกเป็นภาษาอังกฤษ)\n" +
      "Include title, e.g., Assoc. Prof. Dr., if applicable.\n(For international faculty, please complete in English.)",
    fieldType: FormFieldType.TEXT,
    isRequired: true,
    sortOrder: 0,
  },
  {
    key: "group_photo_index",
    label: "หมายเลขถ่ายภาพหมู่ / Group Photo Number",
    fieldType: FormFieldType.TEXT,
    isRequired: true,
    sortOrder: 1,
  },
  {
    key: "phone_number",
    label: "หมายเลขโทรศัพท์ / Phone Number",
    fieldType: FormFieldType.PHONE,
    isRequired: true,
    sortOrder: 2,
  },
];

export async function createUniversity(formData: FormData) {
  await requireSuperadmin();

  const parsed = universitySchema.parse({
    slug: formData.get("slug"),
    name: formData.get("name"),
  });

  const university = await prisma.university.create({
    data: {
      ...parsed,
      formFields: { create: DEFAULT_FORM_FIELDS },
    },
  });

  revalidatePath("/admin/universities");
  redirect(`/admin/universities/${university.id}`);
}

export type UpdateUniversityState = { success: boolean; savedAt: number } | null;

export async function updateUniversity(
  universityId: string,
  _prevState: UpdateUniversityState,
  formData: FormData,
): Promise<UpdateUniversityState> {
  await requireSuperadmin();

  const parsed = universitySchema.parse({
    slug: formData.get("slug"),
    name: formData.get("name"),
    themeColor: formData.get("themeColor") || undefined,
  });

  await prisma.university.update({ where: { id: universityId }, data: parsed });

  revalidatePath("/admin/universities");
  revalidatePath(`/admin/universities/${universityId}`);

  return { success: true, savedAt: Date.now() };
}

export async function setUniversityActive(
  universityId: string,
  isActive: boolean,
) {
  await requireSuperadmin();

  await prisma.university.update({
    where: { id: universityId },
    data: { isActive },
  });

  revalidatePath("/admin/universities");
  revalidatePath(`/admin/universities/${universityId}`);
}

const formFieldSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Key must be letters, numbers, and underscores only",
    ),
  label: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  fieldType: z.nativeEnum(FormFieldType),
  options: z.string().optional(),
  isRequired: z.boolean(),
  sortOrder: z.coerce.number().int(),
});

export async function createFormField(
  universityId: string,
  formData: FormData,
) {
  await requireUniversityAccess(universityId);

  const parsed = formFieldSchema.parse({
    key: formData.get("key"),
    label: formData.get("label"),
    description: formData.get("description") || undefined,
    fieldType: formData.get("fieldType"),
    options: formData.get("options") || undefined,
    isRequired: formData.get("isRequired") === "on",
    sortOrder: formData.get("sortOrder") || 0,
  });

  const options =
    parsed.fieldType === FormFieldType.SELECT && parsed.options
      ? parsed.options
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

  await prisma.formFieldDefinition.create({
    data: {
      universityId,
      key: parsed.key,
      label: parsed.label,
      description: parsed.description,
      fieldType: parsed.fieldType,
      options,
      isRequired: parsed.isRequired,
      sortOrder: parsed.sortOrder,
    },
  });

  revalidatePath(`/admin/universities/${universityId}`);
}

export async function updateFormField(
  universityId: string,
  fieldId: string,
  formData: FormData,
) {
  await requireUniversityAccess(universityId);

  const parsed = formFieldSchema.parse({
    key: formData.get("key"),
    label: formData.get("label"),
    description: formData.get("description") || undefined,
    fieldType: formData.get("fieldType"),
    options: formData.get("options") || undefined,
    isRequired: formData.get("isRequired") === "on",
    sortOrder: formData.get("sortOrder") || 0,
  });

  const options =
    parsed.fieldType === FormFieldType.SELECT && parsed.options
      ? parsed.options
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : Prisma.JsonNull;

  await prisma.formFieldDefinition.update({
    where: { id: fieldId, universityId },
    data: {
      key: parsed.key,
      label: parsed.label,
      description: parsed.description ?? null,
      fieldType: parsed.fieldType,
      options,
      isRequired: parsed.isRequired,
      sortOrder: parsed.sortOrder,
    },
  });

  revalidatePath(`/admin/universities/${universityId}`);
}

export async function deleteFormField(universityId: string, fieldId: string) {
  await requireUniversityAccess(universityId);

  await prisma.formFieldDefinition.delete({ where: { id: fieldId } });

  revalidatePath(`/admin/universities/${universityId}`);
}

export async function setChannelPoolMembership(
  universityId: string,
  channelId: string,
  enabled: boolean,
) {
  await requireSuperadmin();

  if (enabled) {
    await prisma.universityChannelPool.upsert({
      where: { universityId_channelId: { universityId, channelId } },
      update: { isActive: true },
      create: { universityId, channelId },
    });
  } else {
    await prisma.universityChannelPool.updateMany({
      where: { universityId, channelId },
      data: { isActive: false },
    });
  }

  revalidatePath(`/admin/universities/${universityId}`);
  revalidatePath(`/admin/channels/${channelId}`);
}
