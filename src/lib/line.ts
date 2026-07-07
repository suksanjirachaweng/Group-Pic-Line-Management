import "server-only";
import { messagingApi, liff, channelAccessToken, HTTPFetchError } from "@line/bot-sdk";
import { decryptSecret } from "@/lib/crypto";

/**
 * Sends a text push message via the given channel's decrypted access token, optionally preceded
 * by an image. When both `imageUrl` and `linkUrl` are given, the image is sent as a tappable
 * Flex "hero image" (like a banner ad — tapping anywhere opens `linkUrl`) instead of a plain
 * image message. `text` may be "" for an image-only send. Each message object in the push
 * counts separately against quota (image/flex = 1, text = 1 if non-empty).
 */
export async function pushTextMessage(
  accessTokenEncrypted: string,
  lineUserId: string,
  text: string,
  imageUrl?: string | null,
  linkUrl?: string | null,
): Promise<void> {
  const client = new messagingApi.MessagingApiClient({
    channelAccessToken: decryptSecret(accessTokenEncrypted),
  });

  const messages: messagingApi.Message[] = [];
  if (imageUrl && linkUrl) {
    messages.push({
      type: "flex",
      altText: text || "รูปภาพ",
      contents: {
        type: "bubble",
        hero: {
          type: "image",
          url: imageUrl,
          size: "full",
          aspectMode: "cover",
          action: { type: "uri", uri: linkUrl },
        },
      },
    });
  } else if (imageUrl) {
    messages.push({ type: "image", originalContentUrl: imageUrl, previewImageUrl: imageUrl });
  }
  if (text) {
    messages.push({ type: "text", text });
  }

  if (messages.length === 0) return;

  await client.pushMessage({ to: lineUserId, messages });
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
    // Left unset, LINE defaults to ["profile", "chat_message.write"] — the registration page
    // only ever calls getProfile()/getFriendship()/requestFriendship(), never sendMessages(),
    // so requesting chat_message.write just adds an unnecessary permission prompt for users.
    scope: ["profile"],
    // LINE's own docs just say "Specify concat" — governs how the query string we append
    // (?university=...&liffId=...) is carried through the LIFF URL. Left unset, a rich-menu
    // "uri" action tap into this LIFF failed with a generic LINE error before ever reaching
    // our server, while the identical URL worked fine tapped as a chat hyperlink.
    permanentLinkPattern: "concat",
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

export type IssuedChannelToken = { accessToken: string; expiresIn: number };

/**
 * Issues a new short-lived channel access token directly from the channel's own ID + secret
 * (`POST /v2/oauth/accessToken`, grant_type=client_credentials) — no manual "Issue" click in
 * LINE Developers Console needed. Despite the name, these are valid for 30 days per LINE's
 * docs and can't be refreshed in place, only reissued; callers should persist `expiresIn` and
 * reissue ahead of it. (Not to be confused with "channel access token v2.1"/"stateless" token
 * issuance, which require a JWT signed with a registered private key — a different flow.)
 */
export async function issueChannelAccessToken(lineChannelId: string, channelSecret: string): Promise<IssuedChannelToken> {
  const client = new channelAccessToken.ChannelAccessTokenClient({});
  try {
    const res = await client.issueChannelToken("client_credentials", lineChannelId, channelSecret);
    return { accessToken: res.access_token, expiresIn: res.expires_in };
  } catch (err) {
    if (err instanceof HTTPFetchError) {
      throw new Error(`${err.status} ${err.statusText}: ${err.body}`);
    }
    throw err;
  }
}

/** Revokes a previously auto-issued short-lived channel access token. Best-effort — never throws. */
export async function revokeChannelAccessToken(accessToken: string): Promise<void> {
  const client = new channelAccessToken.ChannelAccessTokenClient({});
  try {
    await client.revokeChannelToken(accessToken);
  } catch {
    // Old token will simply expire on its own if revocation fails — not fatal.
  }
}
