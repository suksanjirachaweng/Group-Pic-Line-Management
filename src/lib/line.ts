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

/**
 * Sends a single text message as a reply to a webhook event (e.g. "follow"), via the
 * event's replyToken. Reply messages are free and unlimited, unlike pushMessage — always
 * prefer this over pushTextMessage when a replyToken is available.
 */
export async function replyTextMessage(
  accessTokenEncrypted: string,
  replyToken: string,
  text: string,
): Promise<void> {
  const client = new messagingApi.MessagingApiClient({
    channelAccessToken: decryptSecret(accessTokenEncrypted),
  });

  await client.replyMessage({
    replyToken,
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

/**
 * Creates a new LIFF app on this channel pointed at our shared LIFF registration page.
 * The description must not contain "LINE" (or similar) — LINE rejects those — so we use a
 * fixed generic description rather than the channel's own (often "LINE ..."-prefixed) name.
 */
export async function createLiffApp(accessTokenEncrypted: string, endpointUrl: string): Promise<string> {
  const client = new liff.LiffClient({
    channelAccessToken: decryptSecret(accessTokenEncrypted),
  });
  const res = await client.addLIFFApp({
    view: { type: "full", url: endpointUrl },
    description: "Group photo registration form",
  });
  return res.liffId;
}

/** Deletes a LIFF app from this channel. Best-effort — never throws (it may already be gone). */
export async function deleteLiffApp(accessTokenEncrypted: string, liffId: string): Promise<void> {
  const client = new liff.LiffClient({
    channelAccessToken: decryptSecret(accessTokenEncrypted),
  });
  try {
    await client.deleteLIFFApp(liffId);
  } catch {
    // Not fatal — the LIFF app may have already been deleted manually.
  }
}

/** Sets this channel's Messaging API webhook URL. */
export async function setWebhookEndpointUrl(accessTokenEncrypted: string, endpoint: string): Promise<void> {
  const client = new messagingApi.MessagingApiClient({
    channelAccessToken: decryptSecret(accessTokenEncrypted),
  });
  await client.setWebhookEndpoint({ endpoint });
}

export type WebhookEndpointInfo = { endpoint: string; active: boolean };

/** Reads this channel's current webhook URL and whether LINE will actually forward events to it. */
export async function getWebhookEndpointInfo(accessTokenEncrypted: string): Promise<WebhookEndpointInfo> {
  const client = new messagingApi.MessagingApiClient({
    channelAccessToken: decryptSecret(accessTokenEncrypted),
  });
  return client.getWebhookEndpoint();
}

export type MessageQuotaInfo = { type: "limited" | "none"; limit: number | null; consumedThisMonth: number };

/** Reads LINE's own view of this channel's monthly message quota and usage so far this month. */
export async function getMessageQuotaInfo(accessTokenEncrypted: string): Promise<MessageQuotaInfo> {
  const client = new messagingApi.MessagingApiClient({
    channelAccessToken: decryptSecret(accessTokenEncrypted),
  });
  const [quota, consumption] = await Promise.all([client.getMessageQuota(), client.getMessageQuotaConsumption()]);
  return {
    type: quota.type,
    limit: quota.type === "limited" ? (quota.value ?? null) : null,
    consumedThisMonth: consumption.totalUsage,
  };
}

export type IssuedChannelToken = { accessToken: string; expiresIn: number; keyId: string };

/**
 * Issues a new stateless channel access token directly from the channel's own ID + secret
 * (OAuth client-credentials grant) — no manual "Issue" click in LINE Developers Console needed.
 * These tokens expire (~30 days); callers should persist `expiresIn` and refresh ahead of it.
 */
export async function issueChannelAccessToken(lineChannelId: string, channelSecret: string): Promise<IssuedChannelToken> {
  const res = await fetch("https://api.line.me/oauth2/v2.1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: lineChannelId,
      client_secret: channelSecret,
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to issue channel access token (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return { accessToken: data.access_token, expiresIn: data.expires_in, keyId: data.key_id };
}

/** Revokes a previously auto-issued stateless channel access token. Best-effort — never throws. */
export async function revokeChannelAccessToken(lineChannelId: string, channelSecret: string, accessToken: string): Promise<void> {
  try {
    await fetch("https://api.line.me/oauth2/v2.1/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: lineChannelId,
        client_secret: channelSecret,
        access_token: accessToken,
      }),
    });
  } catch {
    // Old token will simply expire on its own if revocation fails — not fatal.
  }
}
