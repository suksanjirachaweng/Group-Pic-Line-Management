import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { messagingApi } from "@line/bot-sdk";
import { decryptSecret } from "@/lib/crypto";

export type RichMenuVariant = "THREE_BUTTON" | "ONE_BUTTON";

// JPEG, not PNG — LINE's rich menu image upload rejects anything over 1MB (413 Request Entity Too
// Large), and this artwork is a detailed photo illustration that PNG can't compress under that
// limit; JPEG at quality ~90 lands comfortably under it with no visible quality loss on the
// text/icons.
const RICH_MENU_IMAGE_PATHS: Record<RichMenuVariant, string> = {
  THREE_BUTTON: path.join(process.cwd(), "public", "richmenu-3button.jpg"),
  ONE_BUTTON: path.join(process.cwd(), "public", "richmenu-1button.jpg"),
};

// This operator's own photo-ordering site — the same for every university this system serves.
// Only used by the THREE_BUTTON variant.
const ORDER_PHOTOS_URL = "https://www.newsalon1999.com/booking.html";
const TRACK_STATUS_URL = "https://www.newsalon1999.com/track.html";

/**
 * Creates and publishes a rich menu for a channel, then deletes whatever rich menu it's
 * replacing. Both variants share the same 2500x1686 canvas and image-per-channel-token upload;
 * they differ only in tappable area layout and which prebuilt image is used. Only the
 * "register" area's target URL differs per channel, built from that channel's own LIFF link.
 */
export async function publishRichMenu(
  accessTokenEncrypted: string,
  registerUrl: string,
  previousRichMenuId: string | null,
  variant: RichMenuVariant,
): Promise<string> {
  const channelAccessToken = decryptSecret(accessTokenEncrypted);
  const client = new messagingApi.MessagingApiClient({ channelAccessToken });
  const blobClient = new messagingApi.MessagingApiBlobClient({ channelAccessToken });

  // THREE_BUTTON: a big left-hand registration button spanning the full height (~70.6% of the
  // width), with "order photos" / "track status" stacked in the remaining right-hand column.
  // ONE_BUTTON: the registration button spans the entire canvas (added 2026-07-24).
  const areas: messagingApi.RichMenuArea[] =
    variant === "THREE_BUTTON"
      ? [
          { bounds: { x: 0, y: 0, width: 1764, height: 1686 }, action: { type: "uri", uri: registerUrl } },
          { bounds: { x: 1764, y: 0, width: 736, height: 843 }, action: { type: "uri", uri: ORDER_PHOTOS_URL } },
          { bounds: { x: 1764, y: 843, width: 736, height: 843 }, action: { type: "uri", uri: TRACK_STATUS_URL } },
        ]
      : [{ bounds: { x: 0, y: 0, width: 2500, height: 1686 }, action: { type: "uri", uri: registerUrl } }];

  const { richMenuId } = await client.createRichMenu({
    size: { width: 2500, height: 1686 },
    selected: true,
    name: "Main",
    chatBarText: "เมนู",
    areas,
  });

  const imageBuffer = await fs.readFile(RICH_MENU_IMAGE_PATHS[variant]);
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
