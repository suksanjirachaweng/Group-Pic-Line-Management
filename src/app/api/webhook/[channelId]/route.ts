import { NextRequest, NextResponse } from "next/server";
import { validateSignature, webhook } from "@line/bot-sdk";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { pushTextMessage } from "@/lib/line";
import { buildLiffRegisterUrl } from "@/lib/liffUrl";
import { currentYearMonth } from "@/lib/quota";

export async function POST(request: NextRequest, { params }: { params: Promise<{ channelId: string }> }) {
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
    const userId = event.source?.type === "user" ? event.source.userId : undefined;
    if (!userId) continue;

    // A channel can serve multiple universities, so the same LINE user can have
    // more than one registrant row bound to this channel.
    await prisma.registrant.updateMany({
      where: { channelId: channel.id, lineUserId: userId },
      data: { isFriend: event.type === "follow" },
    });

    if (event.type === "follow") {
      await sendRegistrationLinkIfSingleUniversity(channel, userId);
    }
  }

  return NextResponse.json({ ok: true });
}

/**
 * A channel can serve multiple universities (many-to-many pool), so we only know which
 * registration link to auto-send when the pool is unambiguous — exactly one active
 * university. Otherwise skip silently; that channel's graduates still reach the form via
 * the usual rich menu / template button link.
 */
async function sendRegistrationLinkIfSingleUniversity(
  channel: { id: string; liffId: string; accessTokenEncrypted: string },
  lineUserId: string,
) {
  const pool = await prisma.universityChannelPool.findMany({
    where: { channelId: channel.id, isActive: true, university: { isActive: true } },
    include: { university: true },
  });
  if (pool.length !== 1) return;

  const university = pool[0].university;
  const url = buildLiffRegisterUrl(channel.liffId, university.slug);
  const text = `ขอบคุณที่เพิ่มเพื่อนนะครับ/ค่ะ!\n\nกดลิงก์ด้านล่างเพื่อลงทะเบียนรับภาพถ่ายหมู่ของ ${university.name} ได้เลย:\n${url}`;

  try {
    await pushTextMessage(channel.accessTokenEncrypted, lineUserId, text);

    // Not routed through the MessageJob queue: MessageJob/MessageLog require an existing
    // Registrant row, but no registrant exists yet at first-follow time. Still counts toward
    // the channel's monthly quota like every other push.
    const yearMonth = currentYearMonth();
    await prisma.channelUsageCounter.upsert({
      where: { channelId_yearMonth: { channelId: channel.id, yearMonth } },
      update: { messagesSent: { increment: 1 } },
      create: { channelId: channel.id, yearMonth, messagesSent: 1 },
    });
  } catch (err) {
    console.error("Failed to send welcome registration link", err);
  }
}
