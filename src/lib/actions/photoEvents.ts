"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUniversityAccess } from "@/lib/authz";
import { PhotoEventStatus } from "@/generated/prisma/enums";

const photoEventSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9-]+$/, "Code must be letters, numbers, and hyphens only"),
  label: z.string().max(200).optional(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  codeRangeMin: z.string().optional(),
  codeRangeMax: z.string().optional(),
});

export type PhotoEventListItem = {
  id: string;
  code: string;
  label: string | null;
  startDate: string;
  endDate: string;
  codeRangeMin: number | null;
  codeRangeMax: number | null;
  status: PhotoEventStatus;
  hiddenFromLiff: boolean;
};

/**
 * The event an upload/import action should target when the caller hasn't asked the admin to pick
 * one explicitly yet — the most recently created ACTIVE event, falling back to any event at all
 * (universities with existing data have the migration-backfilled "MIGRATED" one). A brand new
 * university has no PhotoEvent row at all yet — auto-creates one wide-open "DEFAULT" event on
 * first use rather than forcing every admin to know about events before they can upload a single
 * photo; the explicit multi-event UI (creating a second, narrower-dated event like "KKU68") is
 * opt-in, reached from the events management page once an operator actually needs it.
 */
export async function getDefaultPhotoEventId(universityId: string): Promise<string> {
  await requireUniversityAccess(universityId);
  const event = await prisma.photoEvent.findFirst({
    where: { universityId, status: PhotoEventStatus.ACTIVE },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (event) return event.id;
  const anyEvent = await prisma.photoEvent.findFirst({
    where: { universityId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (anyEvent) return anyEvent.id;

  const created = await prisma.photoEvent.create({
    data: {
      universityId,
      code: "DEFAULT",
      label: null,
      startDate: new Date("1970-01-01"),
      endDate: new Date("2100-01-01"),
    },
  });
  return created.id;
}

/**
 * Resolves the event a list page (group-photos, registrants) should filter to, given the
 * `?eventId=` query param the admin may have picked from the EventFilterDropdown. Falls back to
 * `getDefaultPhotoEventId` when the param is absent, blank, or doesn't actually belong to this
 * university (e.g. a stale/tampered URL) — never trusts the param without checking ownership.
 */
export async function resolveSelectedPhotoEventId(
  universityId: string,
  eventIdParam: string | undefined,
): Promise<string> {
  if (eventIdParam) {
    const owned = await prisma.photoEvent.findUnique({
      where: { id: eventIdParam, universityId },
      select: { id: true },
    });
    if (owned) return owned.id;
  }
  return getDefaultPhotoEventId(universityId);
}

export async function listPhotoEvents(universityId: string): Promise<PhotoEventListItem[]> {
  await requireUniversityAccess(universityId);
  const rows = await prisma.photoEvent.findMany({
    where: { universityId },
    orderBy: { startDate: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    label: r.label,
    startDate: r.startDate.toISOString(),
    endDate: r.endDate.toISOString(),
    codeRangeMin: r.codeRangeMin,
    codeRangeMax: r.codeRangeMax,
    status: r.status,
    hiddenFromLiff: r.hiddenFromLiff,
  }));
}

export type CreatePhotoEventState = { error: string } | { success: true; id: string } | null;

export async function createPhotoEvent(
  universityId: string,
  _prevState: CreatePhotoEventState,
  formData: FormData,
): Promise<CreatePhotoEventState> {
  await requireUniversityAccess(universityId);

  const parsed = photoEventSchema.safeParse({
    code: formData.get("code"),
    label: formData.get("label") || undefined,
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    codeRangeMin: formData.get("codeRangeMin") || undefined,
    codeRangeMax: formData.get("codeRangeMax") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }
  const { code, label, startDate, endDate, codeRangeMin, codeRangeMax } = parsed.data;

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { error: "วันที่ไม่ถูกต้อง" };
  }
  if (start > end) {
    return { error: "วันที่เริ่มต้นต้องมาก่อนวันที่สิ้นสุด" };
  }

  const existing = await prisma.photoEvent.findUnique({
    where: { universityId_code: { universityId, code } },
    select: { id: true },
  });
  if (existing) return { error: `รหัสงาน "${code}" ถูกใช้ไปแล้วในมหาวิทยาลัยนี้` };

  const created = await prisma.photoEvent.create({
    data: {
      universityId,
      code,
      label: label || null,
      startDate: start,
      endDate: end,
      codeRangeMin: codeRangeMin ? Number(codeRangeMin) : null,
      codeRangeMax: codeRangeMax ? Number(codeRangeMax) : null,
    },
  });

  revalidatePath(`/admin/universities/${universityId}/events`);
  return { success: true, id: created.id };
}

export type UpdatePhotoEventState = { error: string } | { success: true; assignedCount: number } | null;

/**
 * Edits an existing event's code/label/date-range/code-range — was previously create-only, with
 * no way to fix a mistake (e.g. a too-narrow end date cutting off graduates who register after
 * the ceremony's original window, see the 2026-07-21 report: a registrant with no photoEventId
 * yet falls outside every event's [startDate,endDate] and becomes invisible on the Registrants
 * page under any event filter until the window is widened or they get tag-matched).
 *
 * After saving the new window, also stamps any still-unassigned registrant (photoEventId null)
 * in this university whose `registeredAt` now falls inside it — the same bootstrap-then-stick
 * rule `buildEventScopedRegistrantWhere` already uses to *display* such registrants under this
 * event's filter, applied here so widening a date range actually claims them instead of just
 * making them visible. Never touches a registrant already stamped to a (possibly different)
 * event — stamping is one-way per the existing sticky-flag convention.
 */
export async function updatePhotoEvent(
  universityId: string,
  photoEventId: string,
  _prevState: UpdatePhotoEventState,
  formData: FormData,
): Promise<UpdatePhotoEventState> {
  await requireUniversityAccess(universityId);

  const parsed = photoEventSchema.safeParse({
    code: formData.get("code"),
    label: formData.get("label") || undefined,
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    codeRangeMin: formData.get("codeRangeMin") || undefined,
    codeRangeMax: formData.get("codeRangeMax") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }
  const { code, label, startDate, endDate, codeRangeMin, codeRangeMax } = parsed.data;

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { error: "วันที่ไม่ถูกต้อง" };
  }
  if (start > end) {
    return { error: "วันที่เริ่มต้นต้องมาก่อนวันที่สิ้นสุด" };
  }

  const existing = await prisma.photoEvent.findUnique({
    where: { universityId_code: { universityId, code } },
    select: { id: true },
  });
  if (existing && existing.id !== photoEventId) {
    return { error: `รหัสงาน "${code}" ถูกใช้ไปแล้วในมหาวิทยาลัยนี้` };
  }

  await prisma.photoEvent.update({
    where: { id: photoEventId, universityId },
    data: {
      code,
      label: label || null,
      startDate: start,
      endDate: end,
      codeRangeMin: codeRangeMin ? Number(codeRangeMin) : null,
      codeRangeMax: codeRangeMax ? Number(codeRangeMax) : null,
    },
  });

  const { count: assignedCount } = await prisma.registrant.updateMany({
    where: { universityId, photoEventId: null, registeredAt: { gte: start, lte: end } },
    data: { photoEventId },
  });

  revalidatePath(`/admin/universities/${universityId}/events`);
  revalidatePath(`/admin/universities/${universityId}/events/${photoEventId}`);
  revalidatePath(`/admin/universities/${universityId}/registrants`);
  return { success: true, assignedCount };
}

export async function updatePhotoEventStatus(
  universityId: string,
  photoEventId: string,
  status: PhotoEventStatus,
): Promise<void> {
  await requireUniversityAccess(universityId);
  await prisma.photoEvent.update({
    where: { id: photoEventId, universityId },
    data: { status },
  });
  revalidatePath(`/admin/universities/${universityId}/events`);
}

/**
 * Freely toggleable, independent of the one-way ACTIVE→ARCHIVE_READY→ARCHIVED lifecycle above —
 * for hiding a superseded-but-still-ACTIVE event's registrants from the student-facing LIFF list
 * (e.g. a professor who registered last year under an old event registers again this year under a
 * new one; last year's entry should stop showing) without running the heavier archive/delete flow.
 * Purely a display toggle: doesn't touch any Registrant/GroupPhoto row.
 */
export async function setPhotoEventLiffVisibility(
  universityId: string,
  photoEventId: string,
  hiddenFromLiff: boolean,
): Promise<void> {
  await requireUniversityAccess(universityId);
  await prisma.photoEvent.update({
    where: { id: photoEventId, universityId },
    data: { hiddenFromLiff },
  });
  revalidatePath(`/admin/universities/${universityId}/events`);
  revalidatePath(`/admin/universities/${universityId}/events/${photoEventId}`);
}
