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
        },
      });

      if (oldAccessToken) {
        await revokeChannelAccessToken(oldAccessToken);
      }
      refreshed++;
    } catch {
      failed++;
    }
  }

  // The one shared LINE Login channel (used for LIFF across every university) has its own
  // independently-expiring token, refreshed the same way.
  const lineLoginRow = await prisma.lineLoginChannel.findUnique({ where: { id: "singleton" } });
  const lineLoginChannel =
    lineLoginRow && lineLoginRow.accessTokenExpiresAt && lineLoginRow.accessTokenExpiresAt <= new Date(Date.now() + REFRESH_WINDOW_MS)
      ? lineLoginRow
      : null;
  if (lineLoginChannel) {
    try {
      const channelSecret = decryptSecret(lineLoginChannel.channelSecretEncrypted);
      const oldAccessToken = decryptSecret(lineLoginChannel.accessTokenEncrypted);
      const issued = await issueChannelAccessToken(lineLoginChannel.channelId, channelSecret);

      await prisma.lineLoginChannel.update({
        where: { id: "singleton" },
        data: {
          accessTokenEncrypted: encryptSecret(issued.accessToken),
          accessTokenExpiresAt: new Date(Date.now() + issued.expiresIn * 1000),
        },
      });

      if (oldAccessToken) {
        await revokeChannelAccessToken(oldAccessToken);
      }
      refreshed++;
    } catch {
      failed++;
    }
  }

  return NextResponse.json({ checked: channels.length + (lineLoginChannel ? 1 : 0), refreshed, failed });
}

export const GET = handle;
export const POST = handle;
