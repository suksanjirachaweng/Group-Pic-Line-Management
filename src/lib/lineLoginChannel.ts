import "server-only";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";

/**
 * Returns the decrypted access token for the one shared LINE Login channel that hosts every
 * university's LIFF app, or an error if it hasn't been configured/issued yet. LIFF apps can't
 * be created directly on a Messaging API channel, so LIFF-related calls always need this
 * channel's token instead of the bot channel's own one.
 */
export async function getSharedLiffAccessToken(): Promise<{ accessTokenEncrypted: string } | { error: string }> {
  const row = await prisma.lineLoginChannel.findUnique({ where: { id: "singleton" } });
  if (!row) {
    return { error: "ยังไม่ได้ตั้งค่า LINE Login channel ตัวกลาง (สำหรับ LIFF) — ไปตั้งที่หน้า LINE Channels ก่อน" };
  }
  if (!decryptSecret(row.accessTokenEncrypted)) {
    return { error: "ตั้งค่า LINE Login channel แล้ว แต่ยังไม่ได้ออก token — ไปกด \"ออก token\" ที่หน้า LINE Channels ก่อน" };
  }
  return { accessTokenEncrypted: row.accessTokenEncrypted };
}
