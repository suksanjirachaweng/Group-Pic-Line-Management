"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSuperadmin } from "@/lib/authz";
import { encryptSecret } from "@/lib/crypto";
import { fetchLiffAppIds } from "@/lib/line";

const channelSchema = z.object({
  name: z.string().min(1).max(200),
  lineChannelId: z.string().min(1).max(100),
  liffId: z.string().min(1).max(100),
  monthlyFreeQuota: z.coerce.number().int().positive(),
  allowOverage: z.boolean(),
});

export async function createChannel(formData: FormData) {
  await requireSuperadmin();

  const parsed = channelSchema.parse({
    name: formData.get("name"),
    lineChannelId: formData.get("lineChannelId"),
    liffId: formData.get("liffId"),
    monthlyFreeQuota: formData.get("monthlyFreeQuota") || 300,
    allowOverage: formData.get("allowOverage") === "on",
  });

  const accessToken = String(formData.get("accessToken") ?? "");
  const channelSecret = String(formData.get("channelSecret") ?? "");
  if (!accessToken || !channelSecret) {
    throw new Error("Access token and channel secret are required");
  }

  const channel = await prisma.channel.create({
    data: {
      ...parsed,
      accessTokenEncrypted: encryptSecret(accessToken),
      channelSecretEncrypted: encryptSecret(channelSecret),
    },
  });

  revalidatePath("/admin/channels");
  redirect(`/admin/channels/${channel.id}`);
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
    liffId: formData.get("liffId"),
    monthlyFreeQuota: formData.get("monthlyFreeQuota") || 300,
    allowOverage: formData.get("allowOverage") === "on",
  });

  const accessToken = formData.get("accessToken");
  const channelSecret = formData.get("channelSecret");

  await prisma.channel.update({
    where: { id: channelId },
    data: {
      ...parsed,
      // Only overwrite secrets if the admin actually typed a new value in the (blank-by-default) field.
      ...(accessToken ? { accessTokenEncrypted: encryptSecret(String(accessToken)) } : {}),
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

export type LiffAppSuggestions = { liffIds: string[] } | { error: string };

/** Looks up LIFF app IDs already registered to this channel via the LIFF server API. */
export async function fetchLiffAppSuggestions(channelId: string): Promise<LiffAppSuggestions> {
  await requireSuperadmin();

  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) return { error: "Channel not found" };

  try {
    const liffIds = await fetchLiffAppIds(channel.accessTokenEncrypted);
    if (liffIds.length === 0) {
      return { error: "No LIFF apps found for this channel — create one in LINE Developers Console first." };
    }
    return { liffIds };
  } catch (err) {
    // LINE's LIFF server API returns a 404 (not an empty list) when the channel has no LIFF app yet.
    if (err instanceof Error && err.message.includes("404")) {
      return { error: "No LIFF apps found for this channel — create one in LINE Developers Console first." };
    }
    return { error: err instanceof Error ? err.message : "Couldn't reach LINE" };
  }
}
