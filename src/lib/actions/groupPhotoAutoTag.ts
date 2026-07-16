"use server";

import { prisma } from "@/lib/prisma";
import { requireUniversityAccess } from "@/lib/authz";
import { computeTiles } from "@/lib/groupPhoto/tileGeometry";

/**
 * Kicks off the background auto-tag pipeline (OCR → accept-all → fix-row-order) for a photo — the
 * mobile "express upload" flow calls this right after crop-confirm and doesn't wait for it; the
 * actual work happens later, a bit at a time, in api/cron/process-group-photo-auto-tag-jobs.
 */
export async function startGroupPhotoAutoTag(universityId: string, groupPhotoId: string): Promise<{ id: string }> {
  await requireUniversityAccess(universityId);

  const photo = await prisma.groupPhoto.findUniqueOrThrow({
    where: { id: groupPhotoId, universityId },
    select: { imageWidth: true, imageHeight: true },
  });
  const tilesTotal = computeTiles(photo.imageWidth, photo.imageHeight).length;

  const job = await prisma.groupPhotoAutoTagJob.create({
    data: { groupPhotoId, tilesTotal },
  });
  return { id: job.id };
}

export type GroupPhotoAutoTagStatus = {
  stage: string;
  tilesDone: number;
  tilesTotal: number;
} | null;

/** Latest auto-tag job for a photo, if any — used by the photos list to show a progress badge. */
export async function getLatestGroupPhotoAutoTagStatus(
  universityId: string,
  groupPhotoId: string,
): Promise<GroupPhotoAutoTagStatus> {
  await requireUniversityAccess(universityId);
  const job = await prisma.groupPhotoAutoTagJob.findFirst({
    where: { groupPhotoId },
    orderBy: { createdAt: "desc" },
    select: { stage: true, tilesDone: true, tilesTotal: true },
  });
  return job;
}
