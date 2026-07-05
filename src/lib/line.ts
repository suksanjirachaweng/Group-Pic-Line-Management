import "server-only";
import { messagingApi, liff } from "@line/bot-sdk";
import { decryptSecret } from "@/lib/crypto";

/** Sends a single text push message via the given channel's decrypted access token. */
export async function pushTextMessage(
  accessTokenEncrypted: string,
  lineUserId: string,
  text: string,
): Promise<void> {
  const client = new messagingApi.MessagingApiClient({
    channelAccessToken: decryptSecret(accessTokenEncrypted),
  });

  await client.pushMessage({
    to: lineUserId,
    messages: [{ type: "text", text }],
  });
}

export type LineBotInfo = { basicId: string; displayName: string; pictureUrl: string | null };

/** Fetches the bot's basic ID, display name, and profile picture from the LINE Messaging API. */
export async function fetchLineBotInfo(accessTokenEncrypted: string): Promise<LineBotInfo> {
  const client = new messagingApi.MessagingApiClient({
    channelAccessToken: decryptSecret(accessTokenEncrypted),
  });
  const info = await client.getBotInfo();
  return { basicId: info.basicId, displayName: info.displayName, pictureUrl: info.pictureUrl ?? null };
}

/** Lists the LIFF app IDs already registered to this channel (via the LIFF server API). */
export async function fetchLiffAppIds(accessTokenEncrypted: string): Promise<string[]> {
  const client = new liff.LiffClient({
    channelAccessToken: decryptSecret(accessTokenEncrypted),
  });
  const res = await client.getAllLIFFApps();
  return (res.apps ?? []).map((app) => app.liffId).filter((id): id is string => !!id);
}
