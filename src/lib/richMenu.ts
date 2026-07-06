import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { messagingApi } from "@line/bot-sdk";
import { decryptSecret } from "@/lib/crypto";

const RICH_MENU_IMAGE_PATH = path.join(process.cwd(), "public", "richmenu.png");

// This operator's own photo-ordering site — the same for every university this system serves.
const ORDER_PHOTOS_URL = "https://www.newsalon1999.com/booking.html";
const TRACK_STATUS_URL = "https://www.newsalon1999.com/track.html";

/**
 * Creates and publishes the standard 3-button rich menu (register / order photos / track
 * status) for a channel, then deletes whatever rich menu it's replacing. The image is
 * shared across every channel — only the "register" area's target URL differs, built from
 * that channel's own LIFF link.
 */
export async function publishRichMenu(
  accessTokenEncrypted: string,
  registerUrl: string,
  previousRichMenuId: string | null,
): Promise<string> {
  const channelAccessToken = decryptSecret(accessTokenEncrypted);
  const client = new messagingApi.MessagingApiClient({ channelAccessToken });
  const blobClient = new messagingApi.MessagingApiBlobClient({ channelAccessToken });

  const { richMenuId } = await client.createRichMenu({
    size: { width: 2500, height: 843 },
    selected: true,
    name: "Main",
    chatBarText: "เมนู",
    areas: [
      { bounds: { x: 0, y: 0, width: 833, height: 843 }, action: { type: "uri", uri: registerUrl } },
      { bounds: { x: 833, y: 0, width: 834, height: 843 }, action: { type: "uri", uri: ORDER_PHOTOS_URL } },
      { bounds: { x: 1667, y: 0, width: 833, height: 843 }, action: { type: "uri", uri: TRACK_STATUS_URL } },
    ],
  });

  const imageBuffer = await fs.readFile(RICH_MENU_IMAGE_PATH);
  await blobClient.setRichMenuImage(richMenuId, new Blob([new Uint8Array(imageBuffer)], { type: "image/png" }));
  await client.setDefaultRichMenu(richMenuId);

  if (previousRichMenuId && previousRichMenuId !== richMenuId) {
    try {
      await client.deleteRichMenu(previousRichMenuId);
    } catch {
      // Previous rich menu may already be gone (e.g. deleted manually) — not fatal.
    }
  }

  return richMenuId;
}
