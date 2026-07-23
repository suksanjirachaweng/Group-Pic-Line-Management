import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { messagingApi } from "@line/bot-sdk";
import { decryptSecret } from "@/lib/crypto";

// JPEG, not PNG — LINE's rich menu image upload rejects anything over 1MB (413 Request Entity Too
// Large), and this artwork is a detailed photo illustration that PNG can't compress under that
// limit (came out ~2MB as PNG); JPEG at quality 90 lands comfortably under it (~380KB) with no
// visible quality loss on the text/icons.
const RICH_MENU_IMAGE_PATH = path.join(process.cwd(), "public", "richmenu.jpg");

/**
 * Creates and publishes the single-button rich menu (register) for a channel, then deletes
 * whatever rich menu it's replacing. The image is shared across every channel — only the
 * area's target URL differs, built from that channel's own LIFF link.
 */
export async function publishRichMenu(
  accessTokenEncrypted: string,
  registerUrl: string,
  previousRichMenuId: string | null,
): Promise<string> {
  const channelAccessToken = decryptSecret(accessTokenEncrypted);
  const client = new messagingApi.MessagingApiClient({ channelAccessToken });
  const blobClient = new messagingApi.MessagingApiBlobClient({ channelAccessToken });

  // Large-format canvas (2500x1686) — matches richmenu.jpg's own layout: the registration
  // button now spans the entire canvas (2026-07-24, dropped the "order photos" / "track
  // status" buttons that used to share the right-hand column).
  const { richMenuId } = await client.createRichMenu({
    size: { width: 2500, height: 1686 },
    selected: true,
    name: "Main",
    chatBarText: "เมนู",
    areas: [{ bounds: { x: 0, y: 0, width: 2500, height: 1686 }, action: { type: "uri", uri: registerUrl } }],
  });

  const imageBuffer = await fs.readFile(RICH_MENU_IMAGE_PATH);
  await blobClient.setRichMenuImage(richMenuId, new Blob([new Uint8Array(imageBuffer)], { type: "image/jpeg" }));
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
