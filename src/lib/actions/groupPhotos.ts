"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUniversityAccess } from "@/lib/authz";
import { getAppBaseUrl } from "@/lib/appUrl";
import { normalizeCode } from "@/lib/groupPhoto/normalizeCode";
import { interpolateTemplate } from "@/lib/rules/evaluate";
import { TagMatchSource } from "@/generated/prisma/enums";

export async function createGroupPhoto(
  universityId: string,
  input: { name: string; imageUrl: string; imageWidth: number; imageHeight: number },
): Promise<{ id: string }> {
  await requireUniversityAccess(universityId);

  const lastPhoto = await prisma.groupPhoto.findFirst({
    where: { universityId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const photo = await prisma.groupPhoto.create({
    data: { universityId, ...input, sortOrder: (lastPhoto?.sortOrder ?? -1) + 1 },
  });

  revalidatePath(`/admin/universities/${universityId}/group-photos`);
  return { id: photo.id };
}

export async function deleteGroupPhoto(universityId: string, groupPhotoId: string): Promise<void> {
  await requireUniversityAccess(universityId);
  await prisma.groupPhoto.delete({ where: { id: groupPhotoId, universityId } });
  revalidatePath(`/admin/universities/${universityId}/group-photos`);
}

export type SaveTagInput = {
  id?: string; // present = update an existing tag, absent = create a new one
  code: string;
  name: string;
  row: number;
  order: number;
  x: number;
  y: number;
  registrantId: string | null;
  matchSource: TagMatchSource;
};

export async function saveGroupPhotoTag(
  universityId: string,
  groupPhotoId: string,
  input: SaveTagInput,
): Promise<{ id: string }> {
  await requireUniversityAccess(universityId);

  const data = {
    groupPhotoId,
    code: input.code,
    normalizedCode: normalizeCode(input.code),
    name: input.name,
    row: input.row,
    order: input.order,
    x: input.x,
    y: input.y,
    registrantId: input.registrantId,
    matchSource: input.matchSource,
  };

  const tag = input.id
    ? await prisma.groupPhotoTag.update({ where: { id: input.id, groupPhotoId }, data })
    : await prisma.groupPhotoTag.create({ data });

  revalidatePath(`/admin/universities/${universityId}/group-photos/${groupPhotoId}`);
  return { id: tag.id };
}

export async function deleteGroupPhotoTag(universityId: string, groupPhotoId: string, tagId: string): Promise<void> {
  await requireUniversityAccess(universityId);
  await prisma.groupPhotoTag.delete({ where: { id: tagId, groupPhotoId } });
  revalidatePath(`/admin/universities/${universityId}/group-photos/${groupPhotoId}`);
}

export async function createGroupPhotoShareLink(
  universityId: string,
  groupPhotoId: string,
): Promise<{ url: string }> {
  await requireUniversityAccess(universityId);

  const existing = await prisma.groupPhotoShareLink.findFirst({
    where: { groupPhotoId, isActive: true },
    orderBy: { createdAt: "desc" },
  });
  const token = existing?.token ?? randomBytes(24).toString("base64url");
  if (!existing) {
    await prisma.groupPhotoShareLink.create({ data: { groupPhotoId, token } });
    revalidatePath(`/admin/universities/${universityId}/group-photos/${groupPhotoId}`);
  }
  return { url: `${getAppBaseUrl()}/photo-review/${token}` };
}

/**
 * Direct LINE send for problem tags — not a reuse of sendBulkMessage as-is, since it starts from
 * registrantIds while this starts from tags that may or may not have a matched registrant. Tags
 * with no registrant match are only eligible for the share-link path.
 */
export async function sendProblemTagMessages(
  universityId: string,
  groupPhotoId: string,
  tagIds: string[],
  body: string,
): Promise<{ count: number }> {
  await requireUniversityAccess(universityId);

  const tags = await prisma.groupPhotoTag.findMany({
    where: { id: { in: tagIds }, groupPhotoId, registrantId: { not: null } },
    include: { registrant: true },
  });
  const eligible = tags.filter((t) => t.registrant?.lineUserId && t.registrant?.channelId);
  if (eligible.length === 0) return { count: 0 };

  await prisma.messageJob.createMany({
    data: eligible.map((t) => ({
      registrantId: t.registrant!.id,
      channelId: t.registrant!.channelId!,
      source: "MANUAL" as const,
      body: interpolateTemplate(body, {
        displayName: t.registrant!.displayName,
        data: (t.registrant!.data ?? {}) as Record<string, unknown>,
      }),
    })),
  });

  return { count: eligible.length };
}
