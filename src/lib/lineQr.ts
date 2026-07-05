import "server-only";
import QRCode from "qrcode";
import { prisma } from "@/lib/prisma";
import { fetchLineBotInfo, type LineBotInfo } from "@/lib/line";
import type { Channel } from "@/generated/prisma/client";

export function addFriendUrl(basicId: string): string {
  return `https://line.me/R/ti/p/${encodeURIComponent(basicId)}`;
}

/** Returns the channel's cached LINE bot info, fetching and persisting it on first use. */
export async function ensureLineBotInfo(channel: Channel): Promise<LineBotInfo | null> {
  if (channel.lineBasicId && channel.lineDisplayName) {
    return {
      basicId: channel.lineBasicId,
      displayName: channel.lineDisplayName ?? "",
      pictureUrl: channel.linePictureUrl,
    };
  }

  try {
    const info = await fetchLineBotInfo(channel.accessTokenEncrypted);
    await prisma.channel.update({
      where: { id: channel.id },
      data: { lineBasicId: info.basicId, lineDisplayName: info.displayName, linePictureUrl: info.pictureUrl },
    });
    return info;
  } catch {
    return null;
  }
}

export type ChannelQrInfo = LineBotInfo & { addFriendUrl: string; qrDataUrl: string };

/** Resolves the channel's LINE bot info and renders its "add friend" QR code, or null if unavailable. */
export async function getChannelQrInfo(channel: Channel): Promise<ChannelQrInfo | null> {
  const info = await ensureLineBotInfo(channel);
  if (!info) return null;

  const url = addFriendUrl(info.basicId);
  const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 240 });
  return { ...info, addFriendUrl: url, qrDataUrl };
}
