import { NextRequest, NextResponse } from "next/server";
import { HTTPFetchError } from "@line/bot-sdk";
import { prisma } from "@/lib/prisma";
import { pushTextMessage } from "@/lib/line";
import { currentYearMonth } from "@/lib/quota";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { recordCronHeartbeat } from "@/lib/cronHeartbeat";

const JOB_KEY = "process-message-jobs";

const BATCH_SIZE = 50;

async function claimBatch(): Promise<string[]> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "message_jobs"
      WHERE "status" = 'QUEUED'
      ORDER BY "createdAt" ASC
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    `;
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) {
      await tx.messageJob.updateMany({ where: { id: { in: ids } }, data: { status: "SENDING" } });
    }
    return ids;
  });
}

async function handle(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    return await run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordCronHeartbeat(JOB_KEY, "ERROR", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function run() {
  const claimedIds = await claimBatch();
  if (claimedIds.length === 0) {
    await recordCronHeartbeat(JOB_KEY, "OK");
    return NextResponse.json({ processed: 0, sent: 0, failed: 0, skippedQuota: 0 });
  }

  const jobs = await prisma.messageJob.findMany({
    where: { id: { in: claimedIds } },
    include: { registrant: true, channel: true },
  });

  const yearMonth = currentYearMonth();
  let sent = 0;
  let failed = 0;
  let skippedQuota = 0;

  for (const job of jobs) {
    try {
      if (!job.registrant.lineUserId) {
        throw new Error("Registrant has no LINE user id");
      }

      const usage = await prisma.channelUsageCounter.findUnique({
        where: { channelId_yearMonth: { channelId: job.channelId, yearMonth } },
      });
      const overQuota = (usage?.messagesSent ?? 0) >= job.channel.monthlyFreeQuota;

      if (overQuota && !job.channel.allowOverage) {
        await prisma.messageJob.update({
          where: { id: job.id },
          data: { status: "FAILED", lastError: "Channel is over its free quota", processedAt: new Date() },
        });
        if (job.ruleExecutionId) {
          await prisma.ruleExecution.update({
            where: { id: job.ruleExecutionId },
            data: { status: "SKIPPED_QUOTA" },
          });
        }
        skippedQuota++;
        continue;
      }

      await pushTextMessage(job.channel.accessTokenEncrypted, job.registrant.lineUserId, job.body, job.imageUrl, job.linkUrl);

      // Each message object in the push (image/flex, text) counts separately against quota —
      // matches how LINE itself bills the send. Falls back to 1 in case both are somehow empty.
      const messagesCounted = (job.imageUrl ? 1 : 0) + (job.body ? 1 : 0) || 1;

      await prisma.$transaction([
        prisma.messageJob.update({ where: { id: job.id }, data: { status: "SENT", processedAt: new Date() } }),
        prisma.messageLog.create({
          data: { registrantId: job.registrantId, channelId: job.channelId, body: job.body, lineApiResponseStatus: 200 },
        }),
        prisma.channelUsageCounter.upsert({
          where: { channelId_yearMonth: { channelId: job.channelId, yearMonth } },
          update: { messagesSent: { increment: messagesCounted } },
          create: { channelId: job.channelId, yearMonth, messagesSent: messagesCounted },
        }),
        ...(job.ruleExecutionId
          ? [prisma.ruleExecution.update({ where: { id: job.ruleExecutionId }, data: { status: "SENT", sentAt: new Date() } })]
          : []),
      ]);
      sent++;
    } catch (err) {
      const status = err instanceof HTTPFetchError ? err.status : undefined;
      const message = err instanceof Error ? err.message : String(err);

      await prisma.$transaction([
        prisma.messageJob.update({
          where: { id: job.id },
          data: { status: "FAILED", attempts: { increment: 1 }, lastError: message, processedAt: new Date() },
        }),
        prisma.messageLog.create({
          data: { registrantId: job.registrantId, channelId: job.channelId, body: job.body, lineApiResponseStatus: status },
        }),
        ...(job.ruleExecutionId
          ? [prisma.ruleExecution.update({ where: { id: job.ruleExecutionId }, data: { status: "FAILED", errorDetail: message } })]
          : []),
      ]);
      failed++;
    }
  }

  await recordCronHeartbeat(JOB_KEY, "OK");
  return NextResponse.json({ processed: jobs.length, sent, failed, skippedQuota });
}

export const GET = handle;
export const POST = handle;
