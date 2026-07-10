"use server";

import { randomBytes } from "node:crypto";
import * as XLSX from "xlsx";
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

/**
 * Replaces just the image file behind an existing photo (e.g. a retouched version with a title
 * bar added) — tags are left untouched since they belong to the GroupPhoto row, not the image
 * itself. The new image's geometry may not line up with the old one, so this is normally paired
 * with a bulk position adjustment (see `bulkAdjustTagPositions`) on the tagging page.
 */
export async function updateGroupPhotoImage(
  universityId: string,
  groupPhotoId: string,
  input: { imageUrl: string; imageWidth: number; imageHeight: number },
): Promise<void> {
  await requireUniversityAccess(universityId);
  await prisma.groupPhoto.update({ where: { id: groupPhotoId, universityId }, data: input });
  revalidatePath(`/admin/universities/${universityId}/group-photos/${groupPhotoId}`);
  revalidatePath(`/admin/universities/${universityId}/group-photos`);
}

/**
 * Shifts and/or scales every tag in a photo around a single anchor point in one pass — for when
 * a re-uploaded image (see `updateGroupPhotoImage`) shifted everyone's position relative to the
 * old one (e.g. added padding, slight crop/zoom difference), so re-tagging from scratch isn't
 * necessary.
 */
export async function bulkAdjustTagPositions(
  universityId: string,
  groupPhotoId: string,
  input: { dx: number; dy: number; scale: number; anchorX: number; anchorY: number },
): Promise<void> {
  await requireUniversityAccess(universityId);
  const tags = await prisma.groupPhotoTag.findMany({ where: { groupPhotoId }, select: { id: true, x: true, y: true } });
  await prisma.$transaction(
    tags.map((t) =>
      prisma.groupPhotoTag.update({
        where: { id: t.id },
        data: {
          x: input.anchorX + (t.x - input.anchorX) * input.scale + input.dx,
          y: input.anchorY + (t.y - input.anchorY) * input.scale + input.dy,
        },
      }),
    ),
  );
  revalidatePath(`/admin/universities/${universityId}/group-photos/${groupPhotoId}`);
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

  // `row`/`order` are meant to stay a dense 0..N sequence per row (drives the row-line drawing
  // and the legacy-format export's left-to-right ordering) — so placing a tag at a slot another
  // tag already occupies "inserts" it there instead of colliding: everyone from that slot onward
  // shifts over by one to make room, and moving a tag away from its old slot closes the gap it
  // leaves behind. This lets a missed person get added in the middle of an already-tagged row
  // without manually renumbering everyone after them by hand.
  const tag = await prisma.$transaction(async (tx) => {
    if (input.id) {
      const existing = await tx.groupPhotoTag.findUniqueOrThrow({
        where: { id: input.id, groupPhotoId },
        select: { row: true, order: true },
      });
      if (existing.row === input.row) {
        if (input.order > existing.order) {
          await tx.groupPhotoTag.updateMany({
            where: {
              groupPhotoId,
              row: input.row,
              order: { gt: existing.order, lte: input.order },
              id: { not: input.id },
            },
            data: { order: { decrement: 1 } },
          });
        } else if (input.order < existing.order) {
          await tx.groupPhotoTag.updateMany({
            where: {
              groupPhotoId,
              row: input.row,
              order: { gte: input.order, lt: existing.order },
              id: { not: input.id },
            },
            data: { order: { increment: 1 } },
          });
        }
      } else {
        await tx.groupPhotoTag.updateMany({
          where: { groupPhotoId, row: existing.row, order: { gt: existing.order } },
          data: { order: { decrement: 1 } },
        });
        await tx.groupPhotoTag.updateMany({
          where: { groupPhotoId, row: input.row, order: { gte: input.order } },
          data: { order: { increment: 1 } },
        });
      }
      return tx.groupPhotoTag.update({ where: { id: input.id, groupPhotoId }, data });
    }

    await tx.groupPhotoTag.updateMany({
      where: { groupPhotoId, row: input.row, order: { gte: input.order } },
      data: { order: { increment: 1 } },
    });
    return tx.groupPhotoTag.create({ data });
  });

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

export type MarkFileImportState = { error: string } | { success: true; count: number } | null;

/**
 * Bulk-loads tag positions from a file matching the legacy desktop tool's export format (see
 * LEGACY_EXCEL_HEADERS: ชื่อ-นามสกุล, CODE, แถว, ลำดับ, X, Y, คณะ) — for photos that already have
 * a ground-truth mark file instead of needing manual placement or face-detect. Replaces every
 * existing tag on this photo, matching importLegacyReferences' "whole-set replace" semantics.
 * Uses the `xlsx` package (not exceljs) because the real files are legacy binary .xls, which
 * exceljs can't read.
 */
export async function importGroupPhotoTagsFromMarkFile(
  universityId: string,
  groupPhotoId: string,
  _prevState: MarkFileImportState,
  formData: FormData,
): Promise<MarkFileImportState> {
  await requireUniversityAccess(universityId);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "ยังไม่ได้เลือกไฟล์" };

  let rows: unknown[][];
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) return { error: "ไฟล์ไม่มีชีทข้อมูล" };
    rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][];
  } catch (err) {
    return { error: `อ่านไฟล์ไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}` };
  }

  const parsed: { name: string; code: string; row: number; order: number; x: number; y: number }[] = [];
  for (const r of rows.slice(1)) {
    const code = String(r[1] ?? "").trim();
    if (!code) continue;
    const row = Number(r[2]);
    const order = Number(r[3]);
    const x = Number(r[4]);
    const y = Number(r[5]);
    if ([row, order, x, y].some((n) => Number.isNaN(n))) continue;
    parsed.push({ name: String(r[0] ?? "").trim(), code, row, order, x, y });
  }

  if (parsed.length === 0) {
    return { error: "ไม่พบข้อมูลที่ใช้ได้ในไฟล์ (ต้องมีคอลัมน์: ชื่อ-นามสกุล, CODE, แถว, ลำดับ, X, Y)" };
  }

  const [registrantRows, referenceRows] = await Promise.all([
    prisma.registrant.findMany({ where: { universityId }, select: { id: true, data: true } }),
    prisma.groupPhotoLegacyReference.findMany({ where: { universityId }, select: { normalizedCode: true } }),
  ]);
  const registrantByCode = new Map<string, string>();
  for (const r of registrantRows) {
    const raw = (r.data as Record<string, unknown> | null)?.group_photo_index;
    if (typeof raw === "string" && raw.trim()) registrantByCode.set(normalizeCode(raw), r.id);
  }
  const legacyCodes = new Set(referenceRows.map((r) => r.normalizedCode));

  await prisma.$transaction([
    prisma.groupPhotoTag.deleteMany({ where: { groupPhotoId } }),
    prisma.groupPhotoTag.createMany({
      data: parsed.map((p) => {
        const normalizedCode = normalizeCode(p.code);
        const registrantId = registrantByCode.get(normalizedCode) ?? null;
        const matchSource: TagMatchSource = registrantId
          ? TagMatchSource.REGISTRANT
          : legacyCodes.has(normalizedCode)
            ? TagMatchSource.LEGACY_REFERENCE
            : TagMatchSource.MANUAL;
        return {
          groupPhotoId,
          code: p.code,
          normalizedCode,
          name: p.name,
          row: p.row,
          order: p.order,
          x: p.x,
          y: p.y,
          registrantId,
          matchSource,
        };
      }),
    }),
  ]);

  revalidatePath(`/admin/universities/${universityId}/group-photos/${groupPhotoId}`);
  return { success: true, count: parsed.length };
}
