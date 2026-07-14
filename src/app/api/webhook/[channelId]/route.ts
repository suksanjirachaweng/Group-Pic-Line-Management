import { NextRequest, NextResponse } from "next/server";
import { validateSignature, webhook } from "@line/bot-sdk";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { replyTextMessage, getLineUserProfile } from "@/lib/line";
import { buildLiffRegisterUrl } from "@/lib/liffUrl";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await params;

  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) {
    return new NextResponse("Unknown channel", { status: 404 });
  }

  const signature = request.headers.get("x-line-signature");
  if (!signature) {
    return new NextResponse("Missing signature", { status: 401 });
  }

  // Signature must be verified against the exact raw body bytes — never JSON.parse first.
  const rawBody = await request.text();
  const channelSecret = decryptSecret(channel.channelSecretEncrypted);
  if (!validateSignature(rawBody, channelSecret, signature)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  const body = JSON.parse(rawBody) as webhook.CallbackRequest;

  for (const event of body.events ?? []) {
    if (event.type !== "follow" && event.type !== "unfollow") continue;
    const userId =
      event.source?.type === "user" ? event.source.userId : undefined;
    if (!userId) continue;

    // A channel can serve multiple universities, so the same LINE user can have
    // more than one registrant row bound to this channel.
    await prisma.registrant.updateMany({
      where: { channelId: channel.id, lineUserId: userId },
      data: { isFriend: event.type === "follow" },
    });

    if (event.type === "follow") {
      // Tracked independently of Registrant — a follow event alone never creates a Registrant
      // row (that only happens once someone actually submits the registration form), so without
      // this there's no way to later list "added the LINE friend but never registered."
      const profile = await getLineUserProfile(channel.accessTokenEncrypted, userId);
      await prisma.lineFollower.upsert({
        where: { channelId_lineUserId: { channelId: channel.id, lineUserId: userId } },
        create: {
          channelId: channel.id,
          lineUserId: userId,
          displayName: profile?.displayName,
          pictureUrl: profile?.pictureUrl,
        },
        update: {
          unfollowedAt: null,
          ...(profile ? { displayName: profile.displayName, pictureUrl: profile.pictureUrl } : {}),
        },
      });

      if (event.replyToken) {
        await sendRegistrationLinkIfSingleUniversity(channel, event.replyToken);
      }
    } else {
      // updateMany, not update — an unfollow for a user whose very first-ever event predates
      // this feature (no LineFollower row yet) should be a silent no-op, not a thrown error.
      await prisma.lineFollower.updateMany({
        where: { channelId: channel.id, lineUserId: userId },
        data: { unfollowedAt: new Date() },
      });
    }
  }

  return NextResponse.json({ ok: true });
}

/**
 * A channel can serve multiple universities (many-to-many pool), so we only know which
 * registration link to auto-send when the pool is unambiguous — exactly one active
 * university. Otherwise skip silently; that channel's graduates still reach the form via
 * the usual rich menu / template button link.
 *
 * Sent via replyMessage (using the follow event's replyToken) rather than pushMessage —
 * replies are free and unlimited, so this never touches the channel's monthly quota.
 */
async function sendRegistrationLinkIfSingleUniversity(
  channel: { id: string; liffId: string; accessTokenEncrypted: string },
  replyToken: string,
) {
  const pool = await prisma.universityChannelPool.findMany({
    where: {
      channelId: channel.id,
      isActive: true,
      university: { isActive: true },
    },
    include: { university: true },
  });
  if (pool.length !== 1) return;

  const university = pool[0].university;
  const url = buildLiffRegisterUrl(channel.liffId, university.slug);
  const text = `ขอบคุณที่เพิ่มเพื่อนนะครับ/ค่ะ!\n\nกดลิงก์ด้านล่างเพื่อลงทะเบียนถ่ายภาพหมู่ของ ${university.name} ได้เลย:\n${url}`;

  try {
    await replyTextMessage(channel.accessTokenEncrypted, replyToken, text);
  } catch (err) {
    console.error("Failed to send welcome registration link", err);
  }
}
