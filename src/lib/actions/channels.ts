"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { requireSuperadmin } from "@/lib/authz";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import {
  fetchLineBotInfo,
  issueChannelAccessToken,
  revokeChannelAccessToken,
  setWebhookEndpointUrl,
  createLiffApp,
  deleteLiffApp,
  getMessageQuotaInfo,
} from "@/lib/line";
import { publishRichMenu } from "@/lib/richMenu";
import { buildLiffRegisterUrl } from "@/lib/liffUrl";
import { getAppBaseUrl } from "@/lib/appUrl";
import { getSharedLiffAccessToken } from "@/lib/lineLoginChannel";

const channelSchema = z.object({
  name: z.string().min(1).max(200),
  lineChannelId: z.string().min(1).max(100),
  monthlyFreeQuota: z.coerce.number().int().positive(),
  allowOverage: z.boolean(),
});

/**
 * Issues a fresh access token for this channel from its own ID + secret, revokes whichever
 * token it's replacing (if we're the ones who issued it), sets the webhook URL, creates a
 * LIFF app if it doesn't have one yet, and refreshes cached bot info — the full "make this
 * channel usable" sequence, run once right after creation and re-runnable any time after.
 * Best-effort per step: a failure is recorded but doesn't stop the remaining steps.
 */
async function autoConfigureChannel(channelId: string): Promise<{ errors: string[] }> {
  const errors: string[] = [];
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) return { errors: ["Channel not found"] };

  const channelSecret = decryptSecret(channel.channelSecretEncrypted);
  let accessTokenEncrypted = channel.accessTokenEncrypted;

  try {
    const issued = await issueChannelAccessToken(channel.lineChannelId, channelSecret);
    accessTokenEncrypted = encryptSecret(issued.accessToken);
    const expiresAt = new Date(Date.now() + issued.expiresIn * 1000);
    const previousToken = decryptSecret(channel.accessTokenEncrypted);

    await prisma.channel.update({
      where: { id: channelId },
      data: { accessTokenEncrypted, accessTokenExpiresAt: expiresAt },
    });

    if (channel.accessTokenExpiresAt && previousToken) {
      await revokeChannelAccessToken(previousToken);
    }
  } catch (err) {
    errors.push(`Issue access token: ${err instanceof Error ? err.message : String(err)}`);
    return { errors }; // nothing below this works without a valid token
  }

  const appBaseUrl = getAppBaseUrl();

  try {
    await setWebhookEndpointUrl(accessTokenEncrypted, `${appBaseUrl}/api/webhook/${channelId}`);
  } catch (err) {
    errors.push(`Set webhook URL: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!channel.liffId) {
    const liffToken = await getSharedLiffAccessToken();
    if ("error" in liffToken) {
      errors.push(`Create LIFF app: ${liffToken.error}`);
    } else {
      try {
        const liffId = await createLiffApp(liffToken.accessTokenEncrypted, `${appBaseUrl}/liff/register`);
        await prisma.channel.update({ where: { id: channelId }, data: { liffId } });
      } catch (err) {
        errors.push(`Create LIFF app: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  try {
    const info = await fetchLineBotInfo(accessTokenEncrypted);
    await prisma.channel.update({
      where: { id: channelId },
      data: { lineBasicId: info.basicId, lineDisplayName: info.displayName, linePictureUrl: info.pictureUrl },
    });
  } catch (err) {
    errors.push(`Fetch bot info: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { errors };
}

export async function createChannel(formData: FormData) {
  await requireSuperadmin();

  const parsed = channelSchema.parse({
    name: formData.get("name"),
    lineChannelId: formData.get("lineChannelId"),
    monthlyFreeQuota: formData.get("monthlyFreeQuota") || 300,
    allowOverage: formData.get("allowOverage") === "on",
  });

  const channelSecret = String(formData.get("channelSecret") ?? "");
  if (!channelSecret) {
    throw new Error("Channel secret is required");
  }

  const channel = await prisma.channel.create({
    data: {
      ...parsed,
      liffId: "",
      accessTokenEncrypted: encryptSecret(""),
      channelSecretEncrypted: encryptSecret(channelSecret),
    },
  });

  const { errors } = await autoConfigureChannel(channel.id);

  revalidatePath("/admin/channels");
  redirect(`/admin/channels/${channel.id}${errors.length > 0 ? "?setup=partial" : "?setup=ok"}`);
}

export type UpdateChannelState = { success: boolean; savedAt: number } | null;

export async function updateChannel(
  channelId: string,
  _prevState: UpdateChannelState,
  formData: FormData,
): Promise<UpdateChannelState> {
  await requireSuperadmin();

  const parsed = channelSchema.parse({
    name: formData.get("name"),
    lineChannelId: formData.get("lineChannelId"),
    monthlyFreeQuota: formData.get("monthlyFreeQuota") || 300,
    allowOverage: formData.get("allowOverage") === "on",
  });

  const channelSecret = formData.get("channelSecret");

  await prisma.channel.update({
    where: { id: channelId },
    data: {
      ...parsed,
      // Only overwrite the secret if the admin actually typed a new value in the (blank-by-default) field.
      ...(channelSecret ? { channelSecretEncrypted: encryptSecret(String(channelSecret)) } : {}),
    },
  });

  revalidatePath("/admin/channels");
  revalidatePath(`/admin/channels/${channelId}`);

  return { success: true, savedAt: Date.now() };
}

export async function setChannelActive(channelId: string, isActive: boolean) {
  await requireSuperadmin();

  await prisma.channel.update({ where: { id: channelId }, data: { isActive } });

  revalidatePath("/admin/channels");
  revalidatePath(`/admin/channels/${channelId}`);
}

/**
 * Permanently deletes a channel row. `Registrant.channelId` is a nullable FK, so the DB
 * itself would just silently null it out on delete rather than blocking — checked explicitly
 * here instead, so a channel that's actually been used can't be deleted out from under its
 * registrants. MessageJob/MessageLog use required FKs, so those still surface as a P2003
 * from the DB if hit. Use Deactivate instead for a channel that's actually been used.
 */
export async function deleteChannel(channelId: string, _prevState: ChannelActionState): Promise<ChannelActionState> {
  await requireSuperadmin();

  const registrantCount = await prisma.registrant.count({ where: { channelId } });
  if (registrantCount > 0) {
    return {
      success: false,
      error: `ลบไม่ได้ — มีผู้ลงทะเบียน ${registrantCount} คนผูกกับแชนแนลนี้อยู่ ใช้ปุ่ม Deactivate แทน`,
    };
  }

  try {
    await prisma.channel.delete({ where: { id: channelId } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      return {
        success: false,
        error: "ลบไม่ได้ — แชนแนลนี้มีประวัติข้อความผูกอยู่ ใช้ปุ่ม Deactivate แทน",
      };
    }
    return { success: false, error: err instanceof Error ? err.message : "Failed to delete channel" };
  }

  revalidatePath("/admin/channels");
  redirect("/admin/channels");
}

/**
 * Re-fetches the bot's display name/icon/basic ID from LINE and overwrites the cached
 * copy — needed because renaming the OA on LINE's side doesn't otherwise propagate here.
 */
export async function refreshLineBotInfo(channelId: string) {
  await requireSuperadmin();

  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel || !decryptSecret(channel.accessTokenEncrypted)) return;

  try {
    const info = await fetchLineBotInfo(channel.accessTokenEncrypted);
    await prisma.channel.update({
      where: { id: channelId },
      data: { lineBasicId: info.basicId, lineDisplayName: info.displayName, linePictureUrl: info.pictureUrl },
    });
  } catch {
    // Best-effort refresh — a bad/expired token shouldn't crash the page, just leave the cached info as-is.
  }

  revalidatePath("/admin/channels");
  revalidatePath(`/admin/channels/${channelId}`);
}

export type ChannelActionState = { success: true; message: string } | { success: false; error: string } | null;

/**
 * Issues a brand-new short-lived access token for this channel from its own ID + secret, and
 * revokes the one it replaces (if we were the ones managing it). No manual "Issue" step in
 * LINE Developers Console needed — but the new token expires in ~30 days, so the refresh
 * cron (`/api/cron/refresh-channel-tokens`) re-runs this automatically ahead of expiry.
 */
export async function issueAccessToken(channelId: string, _prevState: ChannelActionState): Promise<ChannelActionState> {
  await requireSuperadmin();

  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) return { success: false, error: "Channel not found" };

  try {
    const channelSecret = decryptSecret(channel.channelSecretEncrypted);
    const previousToken = decryptSecret(channel.accessTokenEncrypted);
    const issued = await issueChannelAccessToken(channel.lineChannelId, channelSecret);
    const expiresAt = new Date(Date.now() + issued.expiresIn * 1000);

    await prisma.channel.update({
      where: { id: channelId },
      data: {
        accessTokenEncrypted: encryptSecret(issued.accessToken),
        accessTokenExpiresAt: expiresAt,
      },
    });

    if (channel.accessTokenExpiresAt && previousToken) {
      await revokeChannelAccessToken(previousToken);
    }

    revalidatePath(`/admin/channels/${channelId}`);
    return { success: true, message: `ออก token ใหม่แล้ว หมดอายุ ${expiresAt.toLocaleString()}` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to issue access token" };
  }
}

/** Points this channel's Messaging API webhook at our own `/api/webhook/[channelId]` route. */
export async function setChannelWebhook(channelId: string, _prevState: ChannelActionState): Promise<ChannelActionState> {
  await requireSuperadmin();

  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) return { success: false, error: "Channel not found" };

  try {
    const url = `${getAppBaseUrl()}/api/webhook/${channelId}`;
    await setWebhookEndpointUrl(channel.accessTokenEncrypted, url);
    revalidatePath(`/admin/channels/${channelId}`);
    return { success: true, message: `ตั้ง webhook URL เป็น ${url} แล้ว` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to set webhook URL" };
  }
}

/**
 * Creates (or replaces) this channel's LIFF app pointed at our shared `/liff/register` page.
 * LIFF apps can't be created directly on a Messaging API channel — this always goes through
 * the one shared LINE Login channel's own token, not this channel's own access token.
 */
export async function createOrRecreateLiffApp(channelId: string, _prevState: ChannelActionState): Promise<ChannelActionState> {
  await requireSuperadmin();

  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) return { success: false, error: "Channel not found" };

  const liffToken = await getSharedLiffAccessToken();
  if ("error" in liffToken) return { success: false, error: liffToken.error };

  try {
    const liffId = await createLiffApp(liffToken.accessTokenEncrypted, `${getAppBaseUrl()}/liff/register`);
    if (channel.liffId) {
      await deleteLiffApp(liffToken.accessTokenEncrypted, channel.liffId);
    }
    await prisma.channel.update({ where: { id: channelId }, data: { liffId } });
    revalidatePath(`/admin/channels/${channelId}`);
    return { success: true, message: `สร้าง LIFF app ใหม่แล้ว (ID: ${liffId})` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to create LIFF app" };
  }
}

/** Pulls LINE's own view of this channel's monthly quota/usage and syncs `monthlyFreeQuota` to match. */
export async function syncQuotaFromLine(channelId: string, _prevState: ChannelActionState): Promise<ChannelActionState> {
  await requireSuperadmin();

  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) return { success: false, error: "Channel not found" };

  try {
    const info = await getMessageQuotaInfo(channel.accessTokenEncrypted);
    if (info.type === "limited" && info.limit !== null) {
      await prisma.channel.update({ where: { id: channelId }, data: { monthlyFreeQuota: info.limit } });
    }
    revalidatePath(`/admin/channels/${channelId}`);
    const limitText = info.type === "limited" ? `${info.limit} ข้อความ/เดือน` : "ไม่จำกัด (แผนเสียเงิน)";
    return { success: true, message: `LINE รายงาน: ${limitText}, ใช้ไปแล้ว ${info.consumedThisMonth} ข้อความเดือนนี้` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to fetch quota from LINE" };
  }
}

export type PublishRichMenuState =
  | { success: true; richMenuId: string }
  | { success: false; error: string }
  | null;

/**
 * Publishes the standard 3-button rich menu (register / order photos / track status) to
 * this channel, deriving the "register" link from the single active university it serves.
 * Only supported when the channel's pool has exactly one active university — with more than
 * one, there's no single link to bake into the rich menu's static action URL.
 */
export async function publishChannelRichMenu(
  channelId: string,
  _prevState: PublishRichMenuState,
): Promise<PublishRichMenuState> {
  await requireSuperadmin();

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: {
      universityPool: {
        where: { isActive: true, university: { isActive: true } },
        include: { university: true },
      },
    },
  });
  if (!channel) return { success: false, error: "Channel not found" };

  if (channel.universityPool.length !== 1) {
    return {
      success: false,
      error:
        channel.universityPool.length === 0
          ? "This channel isn't assigned to any active university's pool yet."
          : "This channel serves more than one university — publishing a rich menu needs exactly one to know which registration link to use.",
    };
  }

  const university = channel.universityPool[0].university;
  const registerUrl = buildLiffRegisterUrl(channel.liffId, university.slug);

  try {
    const richMenuId = await publishRichMenu(channel.accessTokenEncrypted, registerUrl, channel.richMenuId);
    await prisma.channel.update({ where: { id: channelId }, data: { richMenuId } });
    revalidatePath(`/admin/channels/${channelId}`);
    return { success: true, richMenuId };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to publish rich menu" };
  }
}

