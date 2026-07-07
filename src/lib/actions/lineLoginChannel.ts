"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSuperadmin } from "@/lib/authz";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { issueChannelAccessToken, revokeChannelAccessToken } from "@/lib/line";

export type LineLoginChannelActionState = { success: true; message: string } | { success: false; error: string } | null;

const schema = z.object({
  channelId: z.string().min(1).max(100),
});

/** Creates or updates the one shared LINE Login channel's ID/secret (used for LIFF app management). */
export async function saveLineLoginChannel(
  _prevState: LineLoginChannelActionState,
  formData: FormData,
): Promise<LineLoginChannelActionState> {
  await requireSuperadmin();

  const parsed = schema.parse({ channelId: formData.get("channelId") });
  const channelSecret = String(formData.get("channelSecret") ?? "");

  const existing = await prisma.lineLoginChannel.findUnique({ where: { id: "singleton" } });
  if (!existing && !channelSecret) {
    return { success: false, error: "ต้องกรอก Channel secret ตอนตั้งค่าครั้งแรก" };
  }

  await prisma.lineLoginChannel.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      channelId: parsed.channelId,
      channelSecretEncrypted: encryptSecret(channelSecret),
    },
    update: {
      channelId: parsed.channelId,
      ...(channelSecret ? { channelSecretEncrypted: encryptSecret(channelSecret) } : {}),
    },
  });

  revalidatePath("/admin/channels");
  return { success: true, message: "บันทึกแล้ว" };
}

/** Issues (or reissues) the shared LINE Login channel's access token, revoking the one it replaces. */
export async function issueLineLoginChannelToken(_prevState: LineLoginChannelActionState): Promise<LineLoginChannelActionState> {
  await requireSuperadmin();

  const row = await prisma.lineLoginChannel.findUnique({ where: { id: "singleton" } });
  if (!row) return { success: false, error: "ยังไม่ได้ตั้งค่า Channel ID/Secret" };

  try {
    const channelSecret = decryptSecret(row.channelSecretEncrypted);
    const previousToken = decryptSecret(row.accessTokenEncrypted);
    const issued = await issueChannelAccessToken(row.channelId, channelSecret);
    const expiresAt = new Date(Date.now() + issued.expiresIn * 1000);

    await prisma.lineLoginChannel.update({
      where: { id: "singleton" },
      data: { accessTokenEncrypted: encryptSecret(issued.accessToken), accessTokenExpiresAt: expiresAt },
    });

    if (previousToken) {
      await revokeChannelAccessToken(previousToken);
    }

    revalidatePath("/admin/channels");
    return { success: true, message: `ออก token ใหม่แล้ว หมดอายุ ${expiresAt.toLocaleString()}` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to issue access token" };
  }
}
