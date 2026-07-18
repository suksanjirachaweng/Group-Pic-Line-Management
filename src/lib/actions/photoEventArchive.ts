"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUniversityAccess } from "@/lib/authz";
import { deletePhotoEventData } from "@/lib/photoEvent/deletePhotoEventData";
import { reimportEventArchive, type ReimportSummary } from "@/lib/photoEvent/reimportEventArchive";

export type ActionResult = { error: string } | { success: true };

export async function startPhotoEventArchive(universityId: string, photoEventId: string): Promise<ActionResult> {
  await requireUniversityAccess(universityId);
  const event = await prisma.photoEvent.findUnique({ where: { id: photoEventId, universityId } });
  if (!event) return { error: "ไม่พบงานนี้" };

  const existingActiveJob = await prisma.photoEventArchiveJob.findFirst({
    where: { photoEventId, stage: { in: ["EXPORTING_DATA", "COPYING_IMAGES"] } },
  });
  if (existingActiveJob) return { error: "กำลังสำรองข้อมูลของงานนี้อยู่แล้ว" };

  await prisma.photoEventArchiveJob.create({ data: { photoEventId } });
  revalidatePath(`/admin/universities/${universityId}/events/${photoEventId}`);
  return { success: true };
}

export async function confirmDeletePhotoEventData(
  universityId: string,
  photoEventId: string,
  confirmCode: string,
): Promise<ActionResult> {
  await requireUniversityAccess(universityId);
  const event = await prisma.photoEvent.findUnique({ where: { id: photoEventId, universityId } });
  if (!event) return { error: "ไม่พบงานนี้" };
  if (confirmCode.trim() !== event.code) return { error: `กรุณาพิมพ์ "${event.code}" ให้ตรงเพื่อยืนยันการลบ` };

  try {
    await deletePhotoEventData(photoEventId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "เกิดข้อผิดพลาด" };
  }
  revalidatePath(`/admin/universities/${universityId}/events`);
  revalidatePath(`/admin/universities/${universityId}/events/${photoEventId}`);
  return { success: true };
}

export type ReimportActionResult = { error: string } | { success: true; summary: ReimportSummary };

export async function reimportPhotoEventArchiveAction(
  universityId: string,
  photoEventId: string,
): Promise<ReimportActionResult> {
  await requireUniversityAccess(universityId);
  const event = await prisma.photoEvent.findUnique({ where: { id: photoEventId, universityId } });
  if (!event) return { error: "ไม่พบงานนี้" };

  try {
    const summary = await reimportEventArchive(photoEventId);
    revalidatePath(`/admin/universities/${universityId}/events`);
    revalidatePath(`/admin/universities/${universityId}/events/${photoEventId}`);
    return { success: true, summary };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "เกิดข้อผิดพลาด" };
  }
}
