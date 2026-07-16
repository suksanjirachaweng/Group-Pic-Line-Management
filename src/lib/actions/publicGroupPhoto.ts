"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { normalizeCode } from "@/lib/groupPhoto/normalizeCode";
import { RegistrantStatus } from "@/generated/prisma/enums";
import type { TagHistoryEntry, TitleHistoryEntry } from "@/lib/actions/groupPhotos";

export type PublicUpdateState = { error: string } | { success: true } | null;

/**
 * Token-authenticated, NOT session-authenticated — mirrors the register/[slug] precedent (the
 * URL segment is the credential). Never import requireSession/requireUniversityAccess here.
 */
export async function updateTagViaPublicLink(
  token: string,
  tagId: string,
  _prevState: PublicUpdateState,
  formData: FormData,
): Promise<PublicUpdateState> {
  const link = await prisma.groupPhotoShareLink.findUnique({ where: { token } });
  if (!link || !link.isActive) return { error: "ลิงก์นี้ไม่ถูกต้องหรือถูกปิดใช้งานแล้ว" };

  const tag = await prisma.groupPhotoTag.findUnique({ where: { id: tagId } });
  if (!tag || tag.groupPhotoId !== link.groupPhotoId) {
    return { error: "ไม่พบข้อมูลนี้ในรูปที่ลิงก์นี้เกี่ยวข้อง" };
  }

  const name = String(formData.get("name") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim();
  if (!code) return { error: "กรุณากรอกหมายเลข" };

  // Only worth a history entry when the code or name actually changed — a resave of the same
  // values isn't a correction anyone needs a before/after record of.
  const changed = code !== tag.code || name !== tag.name;

  await prisma.$transaction([
    prisma.groupPhotoTag.update({
      where: { id: tagId },
      data: {
        name,
        code,
        normalizedCode: normalizeCode(code),
        editedViaPublicLink: true,
        publicLinkEditedAt: new Date(),
      },
    }),
    ...(changed
      ? [
          prisma.groupPhotoTagHistory.create({
            data: { tagId, code, name, row: tag.row, order: tag.order, source: "PUBLIC_LINK" as const },
          }),
        ]
      : []),
  ]);

  revalidatePath(`/photo-review/${token}`);
  return { success: true };
}

/**
 * Same no-session, URL-is-the-credential model as updateTagViaPublicLink above, but keyed on the
 * group photo id directly rather than a share-link token — this backs the double-click edit
 * dialog on the public /group-photos/[photoId]/validate page, which anyone holding that link can
 * already view and export from (explicit product decision: whoever has the link can also fix a
 * mis-OCR'd code or missing name right there, not just admins).
 */
export async function updateGroupPhotoTagViaValidatePage(
  photoId: string,
  tagId: string,
  _prevState: PublicUpdateState,
  formData: FormData,
): Promise<PublicUpdateState> {
  const tag = await prisma.groupPhotoTag.findUnique({ where: { id: tagId } });
  if (!tag || tag.groupPhotoId !== photoId) {
    return { error: "ไม่พบข้อมูลนี้ในรูปนี้" };
  }

  const name = String(formData.get("name") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim();
  if (!code) return { error: "กรุณากรอกหมายเลข" };

  // A save where neither the name nor the code changed from what's already on file is a
  // confirmation, not an edit — recorded on a separate flag so the sidebar badge can say
  // "ยืนยัน" instead of "แก้ไข", and skipped from history (nothing actually changed to show a
  // before/after for). Code changes count too, not just name — a code-only fix is still a real
  // correction.
  const changed = name !== tag.name.trim() || code !== tag.code;

  await prisma.$transaction([
    prisma.groupPhotoTag.update({
      where: { id: tagId },
      data: {
        name,
        code,
        normalizedCode: normalizeCode(code),
        ...(changed
          ? { editedViaPublicLink: true, publicLinkEditedAt: new Date() }
          : { confirmedViaPublicLink: true, confirmedAt: new Date() }),
      },
    }),
    ...(changed
      ? [
          prisma.groupPhotoTagHistory.create({
            data: { tagId, code, name, row: tag.row, order: tag.order, source: "PUBLIC_LINK" as const },
          }),
        ]
      : []),
  ]);

  revalidatePath(`/group-photos/${photoId}/validate`);
  return { success: true };
}

/**
 * Read-only counterpart to getGroupPhotoTagHistory (admin) — same no-session model as the rest of
 * this file, scoped by photoId so a validate-page visitor can only read history for tags in the
 * photo their link already grants them full edit access to anyway.
 */
export async function getGroupPhotoTagHistoryPublic(photoId: string, tagId: string): Promise<TagHistoryEntry[]> {
  const tag = await prisma.groupPhotoTag.findUnique({ where: { id: tagId }, select: { groupPhotoId: true } });
  if (!tag || tag.groupPhotoId !== photoId) return [];

  const rows = await prisma.groupPhotoTagHistory.findMany({ where: { tagId }, orderBy: { createdAt: "desc" } });
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

/**
 * Same no-session, URL-is-the-credential model as updateGroupPhotoTagViaValidatePage — lets
 * whoever holds the /group-photos/[photoId]/validate link also rename the display title (product
 * decision: title editing gets the same access as the tag fixes already allowed there).
 */
export async function updateGroupPhotoTitlePublic(photoId: string, title: string | null): Promise<void> {
  const photo = await prisma.groupPhoto.findUnique({ where: { id: photoId }, select: { id: true } });
  if (!photo) throw new Error("ไม่พบรูปนี้");

  await prisma.$transaction([
    prisma.groupPhoto.update({ where: { id: photoId }, data: { title } }),
    prisma.groupPhotoTitleHistory.create({ data: { groupPhotoId: photoId, title, source: "PUBLIC_LINK" } }),
  ]);
  revalidatePath(`/group-photos/${photoId}/validate`);
}

/**
 * Read-only counterpart to getGroupPhotoTitleHistory (admin) — same no-session model as the rest
 * of this file, scoped by photoId alone (matches the page's own "anyone with the link can view
 * and edit" trust model).
 */
export async function getGroupPhotoTitleHistoryPublic(photoId: string): Promise<TitleHistoryEntry[]> {
  const rows = await prisma.groupPhotoTitleHistory.findMany({
    where: { groupPhotoId: photoId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

/**
 * Same no-session, URL-is-the-credential model — backs the graduate's own /photo-view self-check
 * link. Only ever moves the ONE tag whose id the graduate's link already points at (never a list
 * they could pick from), so this can't be used to shove someone else's mark around: the caller
 * only knows their own tagId to begin with.
 */
export async function updateOwnTagPosition(groupPhotoId: string, tagId: string, x: number, y: number): Promise<void> {
  const tag = await prisma.groupPhotoTag.findUnique({ where: { id: tagId }, select: { groupPhotoId: true } });
  if (!tag || tag.groupPhotoId !== groupPhotoId) throw new Error("ไม่พบข้อมูลนี้ในรูปนี้");

  await prisma.groupPhotoTag.update({
    where: { id: tagId },
    data: { x, y, editedViaPublicLink: true, publicLinkEditedAt: new Date() },
  });

  revalidatePath(`/photo-view/${groupPhotoId}`);
}

/**
 * Flags a tag as "the graduate says this is wrong and can't fix it themselves" — e.g. their code
 * landed in the wrong group photo entirely, or the position/name doesn't match who they are. Left
 * for an admin to investigate later rather than attempting any auto-correction; also marks the
 * linked Registrant PROBLEM so it surfaces in the admin registrants list even without opening this
 * specific photo.
 */
export async function reportTagProblem(groupPhotoId: string, tagId: string): Promise<void> {
  const tag = await prisma.groupPhotoTag.findUnique({
    where: { id: tagId },
    select: { groupPhotoId: true, registrantId: true },
  });
  if (!tag || tag.groupPhotoId !== groupPhotoId) throw new Error("ไม่พบข้อมูลนี้ในรูปนี้");

  await prisma.$transaction([
    prisma.groupPhotoTag.update({ where: { id: tagId }, data: { reportedProblem: true, reportedAt: new Date() } }),
    ...(tag.registrantId
      ? [prisma.registrant.update({ where: { id: tag.registrantId }, data: { status: RegistrantStatus.PROBLEM } })]
      : []),
  ]);

  revalidatePath(`/photo-view/${groupPhotoId}`);
}

/**
 * The happy-path counterpart to reportTagProblem — the graduate confirms their name/code/position
 * are all correct. Flips the linked Registrant to CONFIRMED so admins can see who's already
 * verified their own placement without opening every photo; a no-op on the Registrant when the tag
 * isn't matched to one (nothing to flip).
 */
export async function confirmOwnTag(groupPhotoId: string, tagId: string): Promise<void> {
  const tag = await prisma.groupPhotoTag.findUnique({
    where: { id: tagId },
    select: { groupPhotoId: true, registrantId: true },
  });
  if (!tag || tag.groupPhotoId !== groupPhotoId) throw new Error("ไม่พบข้อมูลนี้ในรูปนี้");

  if (tag.registrantId) {
    await prisma.registrant.update({ where: { id: tag.registrantId }, data: { status: RegistrantStatus.CONFIRMED } });
  }

  revalidatePath(`/photo-view/${groupPhotoId}`);
}
