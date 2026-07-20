"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUniversityAccess } from "@/lib/authz";
import { RegistrantStatus, DeliveryStatus } from "@/generated/prisma/enums";

export async function updateRegistrantStatus(
  universityId: string,
  registrantId: string,
  formData: FormData,
) {
  await requireUniversityAccess(universityId);

  const status = z.nativeEnum(RegistrantStatus).parse(formData.get("status"));

  await prisma.registrant.update({
    where: { id: registrantId, universityId },
    data: { status },
  });

  revalidatePath(`/admin/universities/${universityId}/registrants/${registrantId}`);
  revalidatePath(`/admin/universities/${universityId}/registrants`);
}

/**
 * Post-tagging photo-delivery lifecycle (registered → ordered → received → no-show/other) —
 * deliberately separate from updateRegistrantStatus above, which tracks registration-quality/
 * rule-engine concerns that this doesn't touch.
 */
export async function updateRegistrantDeliveryStatus(
  universityId: string,
  registrantId: string,
  formData: FormData,
) {
  await requireUniversityAccess(universityId);

  const deliveryStatus = z.nativeEnum(DeliveryStatus).parse(formData.get("deliveryStatus"));

  await prisma.registrant.update({
    where: { id: registrantId, universityId },
    data: { deliveryStatus },
  });

  revalidatePath(`/admin/universities/${universityId}/registrants/${registrantId}`);
  revalidatePath(`/admin/universities/${universityId}/registrants`);
}

export type BulkDeliveryStatusState = { success: true; count: number } | { success: false; error: string } | null;

/**
 * Bulk-sets delivery status for whatever's checked in the registrants list's shared select-form
 * (the same `registrantIds` checkboxes BulkSendButton reads) — a distinct action from bulk-send,
 * since setting status and messaging are two separate admin intents that just happen to share the
 * same "select some rows first" UI.
 */
export async function bulkSetDeliveryStatus(
  universityId: string,
  _prevState: BulkDeliveryStatusState,
  formData: FormData,
): Promise<BulkDeliveryStatusState> {
  await requireUniversityAccess(universityId);

  const registrantIds = formData.getAll("registrantIds").map(String);
  if (registrantIds.length === 0) return { success: false, error: "ยังไม่ได้เลือกผู้รับ" };

  const parsed = z.nativeEnum(DeliveryStatus).safeParse(formData.get("deliveryStatus"));
  if (!parsed.success) return { success: false, error: "สถานะไม่ถูกต้อง" };

  const result = await prisma.registrant.updateMany({
    where: { id: { in: registrantIds }, universityId },
    data: { deliveryStatus: parsed.data },
  });

  revalidatePath(`/admin/universities/${universityId}/registrants`);
  return { success: true, count: result.count };
}

export type BulkMoveEventState = { success: true; count: number } | { success: false; error: string } | null;

/**
 * Manual override for which PhotoEvent a registrant belongs to — normally `photoEventId` is only
 * ever set automatically (bootstrap-then-stick: stamped the first time a tag match succeeds, see
 * resolveTagMatch.ts), with no way to fix a wrong auto-match. This is that escape hatch, e.g. when
 * two events' code ranges/dates overlap and the wrong one claimed a registrant first.
 */
export async function bulkMoveRegistrantsToEvent(
  universityId: string,
  _prevState: BulkMoveEventState,
  formData: FormData,
): Promise<BulkMoveEventState> {
  await requireUniversityAccess(universityId);

  const registrantIds = formData.getAll("registrantIds").map(String);
  if (registrantIds.length === 0) return { success: false, error: "ยังไม่ได้เลือกผู้รับ" };

  const photoEventId = String(formData.get("photoEventId") ?? "");
  if (!photoEventId) return { success: false, error: "กรุณาเลือกงาน (event)" };

  const event = await prisma.photoEvent.findUnique({ where: { id: photoEventId, universityId }, select: { id: true } });
  if (!event) return { success: false, error: "ไม่พบงานนี้ในมหาวิทยาลัยนี้" };

  const result = await prisma.registrant.updateMany({
    where: { id: { in: registrantIds }, universityId },
    data: { photoEventId },
  });

  revalidatePath(`/admin/universities/${universityId}/registrants`);
  return { success: true, count: result.count };
}

export async function sendManualMessage(
  universityId: string,
  registrantId: string,
  formData: FormData,
) {
  await requireUniversityAccess(universityId);

  const body = z.string().min(1).max(2000).parse(formData.get("body"));

  const registrant = await prisma.registrant.findUnique({
    where: { id: registrantId, universityId },
  });
  if (!registrant) throw new Error("Registrant not found");
  if (!registrant.channelId) {
    throw new Error("This registrant has no LINE channel bound yet — they haven't completed registration");
  }

  await prisma.messageJob.create({
    data: {
      registrantId,
      channelId: registrant.channelId,
      source: "MANUAL",
      body,
    },
  });

  revalidatePath(`/admin/universities/${universityId}/registrants/${registrantId}`);
}
