"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUniversityAccess } from "@/lib/authz";
import { isPcPhotoServerConfigured, isPcPhotoServerReachable } from "@/lib/pcPhotoServer";
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

  // Archive images now go to the PC server whenever it's configured (see archiveStorage.ts) — a
  // close-out backup that silently fails to copy every image because the PC happened to be off
  // would still reach ARCHIVE_READY and invite deleting the live data on top of an empty backup,
  // so fail loudly here instead of leaving that to surface mid-job.
  if (isPcPhotoServerConfigured() && !(await isPcPhotoServerReachable())) {
    return { error: "เครื่อง PC เก็บข้อมูลสำรองไม่ตอบสนอง (อาจปิดอยู่หรือไม่ได้เชื่อมต่ออินเทอร์เน็ต) — เปิดเครื่องแล้วลองใหม่อีกครั้ง" };
  }

  await prisma.photoEventArchiveJob.create({ data: { photoEventId } });
  revalidatePath(`/admin/universities/${universityId}/events/${photoEventId}`);
  return { success: true };
}

/**
 * Standalone "ดึงเข้าคลังใบหน้า" trigger — runs just the EMBEDDING_FACES stage the full close-out
 * flow already has, without exporting/copying/closing anything. Reuses the same
 * `PhotoEventArchiveJob`-backed cron machinery (an admin's photos + face-embedding calls can
 * comfortably exceed a single request's time budget) via `facesOnly: true`, which tells the cron
 * route to skip flipping `PhotoEvent.status` to ARCHIVE_READY on completion.
 */
export async function startFaceBankBuild(universityId: string, photoEventId: string): Promise<ActionResult> {
  await requireUniversityAccess(universityId);
  const event = await prisma.photoEvent.findUnique({ where: { id: photoEventId, universityId } });
  if (!event) return { error: "ไม่พบงานนี้" };

  if (!isPcPhotoServerConfigured()) return { error: "ยังไม่ได้ตั้งค่าระบบจดจำใบหน้า (PC server)" };
  if (!(await isPcPhotoServerReachable())) {
    return { error: "เครื่อง PC ไม่ตอบสนอง (อาจปิดอยู่หรือไม่ได้เชื่อมต่ออินเทอร์เน็ต) — เปิดเครื่องแล้วลองใหม่อีกครั้ง" };
  }

  const existingActiveJob = await prisma.photoEventArchiveJob.findFirst({
    where: { photoEventId, stage: { in: ["EXPORTING_DATA", "COPYING_IMAGES", "EMBEDDING_FACES"] } },
  });
  if (existingActiveJob) return { error: "มีงานสำรองข้อมูล/ดึงคลังใบหน้าของ event นี้กำลังทำงานอยู่แล้ว" };

  const facesTotal = await prisma.groupPhotoTag.count({
    where: {
      row: 0,
      name: { not: "" },
      OR: [{ reportedProblem: false }, { problemAcknowledged: true }],
      groupPhoto: { photoEventId },
    },
  });
  if (facesTotal === 0) return { error: "ยังไม่มีแท็กแถวหน้า (แถว 0) ที่มีชื่อและไม่มีปัญหาค้างอยู่ให้ดึงเข้าคลังใบหน้า" };

  await prisma.photoEventArchiveJob.create({
    data: { photoEventId, stage: "EMBEDDING_FACES", facesOnly: true, facesTotal },
  });
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
