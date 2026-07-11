"use server";

import { prisma } from "@/lib/prisma";
import { RegistrantStatus } from "@/generated/prisma/enums";

/**
 * No-session, self-service action from the LIFF "my registrations" list — a graduate whose
 * `taggedPhotos` came back empty (never matched to any GroupPhotoTag, so there's nothing to flag
 * on the photo side) reports that here instead. `lineUserId` is the caller's own profile id from
 * `liff.getProfile()`, checked against the registrant's stored one — the same lightweight
 * ownership check `/api/register`'s edit path already uses, not a real session.
 */
export async function reportNotTagged(registrantId: string, lineUserId: string): Promise<void> {
  const registrant = await prisma.registrant.findUnique({ where: { id: registrantId } });
  if (!registrant || registrant.lineUserId !== lineUserId) {
    throw new Error("ไม่พบข้อมูลการลงทะเบียนนี้");
  }
  await prisma.registrant.update({ where: { id: registrantId }, data: { status: RegistrantStatus.PROBLEM } });
}
