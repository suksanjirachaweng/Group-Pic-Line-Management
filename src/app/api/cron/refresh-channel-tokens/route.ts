import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { issueChannelAccessToken, revokeChannelAccessToken } from "@/lib/line";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";

// Auto-issued tokens are valid ~30 days — refresh anything expiring within the next 3 to
// leave headroom if this cron's schedule slips a run or two.
const REFRESH_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

async function handle(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Only channels we've issued a token for ourselves (accessTokenExpiresAt set) are managed
  // here — manually-issued long-lived tokens (expiresAt null) never expire and are left alone.
  const channels = await prisma.channel.findMany({
    where: { accessTokenExpiresAt: { lte: new Date(Date.now() + REFRESH_WINDOW_MS) } },
  });

  let refreshed = 0;
  let failed = 0;

  for (const channel of channels) {
    try {
      const channelSecret = decryptSecret(channel.channelSecretEncrypted);
      const oldAccessToken = decryptSecret(channel.accessTokenEncrypted);
      const issued = await issueChannelAccessToken(channel.lineChannelId, channelSecret);

      await prisma.channel.update({
        where: { id: channel.id },
        data: {
          accessTokenEncrypted: encryptSecret(issued.accessToken),
          accessTokenExpiresAt: new Date(Date.now() + issued.expiresIn * 1000),
          accessTokenKeyId: issued.keyId,
        },
      });

      if (channel.accessTokenKeyId) {
        await revokeChannelAccessToken(channel.lineChannelId, channelSecret, oldAccessToken);
      }
      refreshed++;
    } catch {
      failed++;
    }
  }

  return NextResponse.json({ checked: channels.length, refreshed, failed });
}

export const GET = handle;
export const POST = handle;
