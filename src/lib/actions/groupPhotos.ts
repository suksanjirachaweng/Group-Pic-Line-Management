"use server";

import { randomBytes } from "node:crypto";
import * as XLSX from "xlsx";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUniversityAccess } from "@/lib/authz";
import { getAppBaseUrl } from "@/lib/appUrl";
import { normalizeCode } from "@/lib/groupPhoto/normalizeCode";
import { interpolateTemplate } from "@/lib/rules/evaluate";
import { TagMatchSource, GroupPhotoStatus, TagHistorySource } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { buildTagMatchMaps, resolveTagMatch, stampRegistrantPhotoEvent } from "@/lib/groupPhoto/resolveTagMatch";

export async function createGroupPhoto(
  universityId: string,
  photoEventId: string,
  input: { name: string; imageUrl: string; imageWidth: number; imageHeight: number },
): Promise<{ id: string }> {
  await requireUniversityAccess(universityId);

  const lastPhoto = await prisma.groupPhoto.findFirst({
    where: { universityId, photoEventId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const photo = await prisma.groupPhoto.create({
    data: { universityId, photoEventId, ...input, sortOrder: (lastPhoto?.sortOrder ?? -1) + 1 },
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

/**
 * Overwrites row/order for many tags at once from a freshly-computed, already collision-free
 * layout (see clusterIntoRows/handleFixAllRowsAndOrder in TagCanvas.tsx) — unlike saveGroupPhotoTag,
 * which shifts everyone else's order to make room for inserting *one* new/moved tag, this assumes
 * the caller has already assigned every tag a distinct (row, order) pair, so it's a plain bulk
 * overwrite rather than anything collision-aware.
 */
export async function bulkUpdateTagRowOrder(
  universityId: string,
  groupPhotoId: string,
  updates: { id: string; row: number; order: number }[],
): Promise<void> {
  await requireUniversityAccess(universityId);
  await prisma.$transaction(
    updates.map((u) =>
      prisma.groupPhotoTag.update({
        where: { id: u.id, groupPhotoId },
        data: { row: u.row, order: u.order },
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
  // Admin-only "dismiss this problem" toggle (see TagEditDialog's checkbox) — excludes the tag
  // from validateTags()'s problem list entirely, on both this page and the public /validate page,
  // without touching the underlying duplicate/unmatched condition itself.
  problemAcknowledged: boolean;
  // Only meaningful when creating a tag straight from an OCR hit (see saveBulkOcrCandidate) — the
  // manual dialog (TagCanvas.tsx's handleSave) always passes `false` here, and the UPDATE branch
  // below always clears it server-side regardless of what's passed, since a deliberate edit-save
  // through the dialog IS the human review this flag exists to prompt.
  ocrLowConfidence: boolean;
};

/**
 * Whether `name` deviates from what the code's current registrant/legacy-reference match would
 * itself supply — computed server-side (never trusting a client-sent flag) so a save can mark a
 * tag "sticky" against later auto-sync overwrites. No match (unmatched code, or a MANUAL entry
 * with nothing to deviate from) is never considered an override.
 */
async function computeNameOverridden(
  universityId: string,
  photoEventId: string,
  normalizedCode: string,
  name: string,
): Promise<boolean> {
  const maps = await buildTagMatchMaps(universityId, photoEventId);
  const match = resolveTagMatch(normalizedCode, maps);
  return match ? name.trim() !== match.name.trim() : false;
}

/**
 * The CREATE half of saveGroupPhotoTag's collision-shifting logic, factored out so the background
 * auto-tag cron job (no session, can't call the auth-gated action below) can create tags with
 * identical row/order behavior to the interactive "accept all" flow. Takes an already-open `tx`
 * so the caller controls the transaction boundary (e.g. wrapping a whole batch of tags in one).
 * `nameOverridden` is always explicit here (not re-derived) since the cron job's bulk-accept path
 * always uses the freshly-resolved match's own name verbatim (never a human deviation).
 */
export async function createGroupPhotoTagCore(
  tx: Prisma.TransactionClient,
  groupPhotoId: string,
  photoEventId: string,
  input: Omit<SaveTagInput, "id"> & { nameOverridden: boolean },
) {
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
    nameOverridden: input.nameOverridden,
    problemAcknowledged: input.problemAcknowledged,
    ocrLowConfidence: input.ocrLowConfidence,
  };
  await tx.groupPhotoTag.updateMany({
    where: { groupPhotoId, row: input.row, order: { gte: input.order } },
    data: { order: { increment: 1 } },
  });
  const created = await tx.groupPhotoTag.create({ data });
  await tx.groupPhotoTagHistory.create({
    data: {
      tagId: created.id,
      code: created.code,
      name: created.name,
      row: created.row,
      order: created.order,
      source: "ADMIN",
    },
  });
  if (input.matchSource === TagMatchSource.REGISTRANT && input.registrantId) {
    await stampRegistrantPhotoEvent(tx, input.registrantId, photoEventId);
  }
  return created;
}

export async function saveGroupPhotoTag(
  universityId: string,
  groupPhotoId: string,
  input: SaveTagInput,
): Promise<{ id: string }> {
  await requireUniversityAccess(universityId);

  const { photoEventId } = await prisma.groupPhoto.findUniqueOrThrow({
    where: { id: groupPhotoId, universityId },
    select: { photoEventId: true },
  });

  const normalizedCode = normalizeCode(input.code);
  const nameOverridden = await computeNameOverridden(universityId, photoEventId, normalizedCode, input.name);

  const data = {
    groupPhotoId,
    code: input.code,
    normalizedCode,
    name: input.name,
    row: input.row,
    order: input.order,
    x: input.x,
    y: input.y,
    registrantId: input.registrantId,
    matchSource: input.matchSource,
    nameOverridden,
    problemAcknowledged: input.problemAcknowledged,
    // A deliberate save through this action's UPDATE path always counts as the human review the
    // flag is asking for, regardless of what the caller passed — never re-derived from input.
    ocrLowConfidence: false,
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
        select: { row: true, order: true, code: true, name: true },
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
      const updated = await tx.groupPhotoTag.update({ where: { id: input.id, groupPhotoId }, data });
      // Only worth a history entry when the code or name actually changed — a pure row/order
      // move (or a no-op resave) isn't a correction anyone needs a before/after record of, and
      // spamming identical-looking entries buried the ones that mattered.
      if (existing.code !== input.code || existing.name !== input.name) {
        await tx.groupPhotoTagHistory.create({
          data: { tagId: updated.id, code: updated.code, name: updated.name, row: updated.row, order: updated.order, source: "ADMIN" },
        });
      }
      if (input.matchSource === TagMatchSource.REGISTRANT && input.registrantId) {
        await stampRegistrantPhotoEvent(tx, input.registrantId, photoEventId);
      }
      return updated;
    }

    return createGroupPhotoTagCore(tx, groupPhotoId, photoEventId, { ...input, nameOverridden });
  });

  revalidatePath(`/admin/universities/${universityId}/group-photos/${groupPhotoId}`);
  return { id: tag.id };
}

export async function deleteGroupPhotoTag(universityId: string, groupPhotoId: string, tagId: string): Promise<void> {
  await requireUniversityAccess(universityId);
  await prisma.groupPhotoTag.delete({ where: { id: tagId, groupPhotoId } });
  revalidatePath(`/admin/universities/${universityId}/group-photos/${groupPhotoId}`);
}

/**
 * Sets the display heading shown on the tagging/validate/photo-view pages — deliberately separate
 * from `name` (which stays the export's "คณะ" column verbatim) since a photo's public-facing title
 * doesn't always match that raw column value. `null`/empty falls back to `name` wherever it's shown.
 */
export async function updateGroupPhotoTitle(
  universityId: string,
  groupPhotoId: string,
  title: string | null,
): Promise<void> {
  await requireUniversityAccess(universityId);
  await prisma.$transaction([
    prisma.groupPhoto.update({ where: { id: groupPhotoId, universityId }, data: { title } }),
    prisma.groupPhotoTitleHistory.create({ data: { groupPhotoId, title, source: "ADMIN" } }),
  ]);
  revalidatePath(`/admin/universities/${universityId}/group-photos/${groupPhotoId}`);
}

/**
 * Direct drag-to-reposition on the admin canvas — a plain click selects the nearest tag, dragging
 * it (without holding Space, which is reserved for panning) moves just its x/y. GroupPhotoTagHistory
 * only tracks code/name/row/order (not position), and a drag never touches any of those — logging
 * one here was always a pure duplicate of whatever the tag's current values already were, which is
 * exactly what was spamming the history log with identical-looking entries on every nudge.
 */
export async function moveGroupPhotoTag(
  universityId: string,
  groupPhotoId: string,
  tagId: string,
  x: number,
  y: number,
): Promise<void> {
  await requireUniversityAccess(universityId);
  await prisma.groupPhotoTag.update({ where: { id: tagId, groupPhotoId }, data: { x, y } });
  revalidatePath(`/admin/universities/${universityId}/group-photos/${groupPhotoId}`);
}

export async function updateGroupPhotoStatus(
  universityId: string,
  groupPhotoId: string,
  status: GroupPhotoStatus,
): Promise<void> {
  await requireUniversityAccess(universityId);
  await prisma.groupPhoto.update({ where: { id: groupPhotoId, universityId }, data: { status } });
  revalidatePath(`/admin/universities/${universityId}/group-photos/${groupPhotoId}`);
  revalidatePath(`/admin/universities/${universityId}/group-photos`);
}

export type TagHistoryEntry = {
  id: string;
  code: string;
  name: string;
  row: number;
  order: number;
  source: TagHistorySource;
  createdAt: string;
};

export async function getGroupPhotoTagHistory(universityId: string, tagId: string): Promise<TagHistoryEntry[]> {
  await requireUniversityAccess(universityId);
  const rows = await prisma.groupPhotoTagHistory.findMany({
    where: { tag: { groupPhoto: { universityId } }, tagId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

/**
 * Wipes every tag's edit history for a photo — called before a bulk operation that redefines the
 * whole photo's tagging state at once (accepting a batch of bulk-OCR candidates, or re-clustering
 * every tag's row/order from scratch). After either of those, the prior per-tag history no longer
 * reads as a meaningful audit trail against the new baseline, so it's cleared rather than kept
 * alongside it.
 */
export async function resetGroupPhotoTagHistory(universityId: string, groupPhotoId: string): Promise<void> {
  await requireUniversityAccess(universityId);
  await prisma.groupPhotoTagHistory.deleteMany({ where: { tag: { groupPhotoId } } });
  revalidatePath(`/admin/universities/${universityId}/group-photos/${groupPhotoId}`);
}

export type TitleHistoryEntry = {
  id: string;
  title: string | null;
  source: TagHistorySource;
  createdAt: string;
};

export async function getGroupPhotoTitleHistory(
  universityId: string,
  groupPhotoId: string,
): Promise<TitleHistoryEntry[]> {
  await requireUniversityAccess(universityId);
  const rows = await prisma.groupPhotoTitleHistory.findMany({
    where: { groupPhotoId, groupPhoto: { universityId } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

/**
 * Re-checks every tag in a photo against the current registrant/legacy-reference data and
 * silently applies any better match it finds — e.g. someone fixes their group_photo_index in
 * LINE after they were already tagged, and the tag should pick that up without an admin having
 * to reopen and re-save it by hand. Only runs while the photo isn't marked DONE yet (marking it
 * done is the explicit "stop auto-touching this" signal); called once per page load from the
 * tagging page's server component, not on any interval.
 */
export async function autoSyncGroupPhotoTags(universityId: string, groupPhotoId: string): Promise<void> {
  await requireUniversityAccess(universityId);

  const photo = await prisma.groupPhoto.findUnique({
    where: { id: groupPhotoId, universityId },
    select: { status: true, photoEventId: true },
  });
  if (!photo || photo.status === "DONE") return;

  const tags = await prisma.groupPhotoTag.findMany({ where: { groupPhotoId } });
  if (tags.length === 0) return;

  const maps = await buildTagMatchMaps(universityId, photo.photoEventId);

  for (const tag of tags) {
    const match = tag.normalizedCode ? resolveTagMatch(tag.normalizedCode, maps) : null;

    let next: { name: string; registrantId: string | null; matchSource: TagMatchSource } | null = null;
    if (match) {
      // Keep registrantId/matchSource in sync with whichever code the tag currently has
      // regardless of nameOverridden — only the displayed NAME is sticky once a human has
      // explicitly chosen a different one than the live registrant/reference data.
      const name = tag.nameOverridden ? tag.name : match.name;
      if (
        tag.registrantId !== match.registrantId ||
        tag.matchSource !== match.matchSource ||
        tag.name !== name
      ) {
        next = { name, registrantId: match.registrantId, matchSource: match.matchSource };
      }
    } else if (tag.registrantId || tag.matchSource !== TagMatchSource.MANUAL) {
      // No registrant/reference matches this code anymore — e.g. the registrant this tag used to
      // be linked to has since moved their own code elsewhere (syncRegistrantGroupPhotoTags
      // handles that release immediately for the one registrant who just edited, but this bulk
      // pass is what catches every other case). Releases to MANUAL; name is left untouched either
      // way, there's nothing better to fall back to.
      next = { name: tag.name, registrantId: null, matchSource: TagMatchSource.MANUAL };
    }
    if (!next) continue;

    await prisma.$transaction([
      prisma.groupPhotoTag.update({ where: { id: tag.id }, data: next }),
      prisma.groupPhotoTagHistory.create({
        data: { tagId: tag.id, code: tag.code, name: next.name, row: tag.row, order: tag.order, source: "AUTO_SYNC" },
      }),
    ]);
    if (next.matchSource === TagMatchSource.REGISTRANT && next.registrantId) {
      await stampRegistrantPhotoEvent(prisma, next.registrantId, photo.photoEventId);
    }
  }
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
