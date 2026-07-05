import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { matchesConditionTree, interpolateTemplate, type ConditionGroup } from "@/lib/rules/evaluate";

type ScheduleConfig = { relativeToField: string; offsetMinutes: number };

/**
 * Evaluates all active SCHEDULED_TICK rules across every university. For each rule,
 * finds registrants whose `relativeToField` date (plus offsetMinutes) has come due and
 * haven't been handled yet, then enqueues a MessageJob via the same idempotent
 * RuleExecution path used by the on_registration trigger.
 */
export async function evaluateScheduledRules(): Promise<{ rulesEvaluated: number; matched: number }> {
  const rules = await prisma.rule.findMany({
    where: { isActive: true, trigger: "SCHEDULED_TICK" },
  });

  let matched = 0;
  const now = Date.now();

  for (const rule of rules) {
    const config = rule.scheduleConfig as ScheduleConfig | null;
    if (!config?.relativeToField) continue;

    const alreadyHandled = new Set(
      (
        await prisma.ruleExecution.findMany({
          where: { ruleId: rule.id },
          select: { registrantId: true },
        })
      ).map((r) => r.registrantId),
    );

    const registrants = await prisma.registrant.findMany({
      where: { universityId: rule.universityId, status: { not: "CANCELLED" }, channelId: { not: null } },
    });

    for (const registrant of registrants) {
      if (alreadyHandled.has(registrant.id)) continue;

      const data = registrant.data as Record<string, unknown>;
      const rawDate = data[config.relativeToField];
      if (rawDate === undefined || rawDate === null || rawDate === "") continue;

      const targetTime = new Date(String(rawDate)).getTime() + config.offsetMinutes * 60_000;
      if (Number.isNaN(targetTime) || targetTime > now) continue; // not due yet

      if (!matchesConditionTree(rule.conditionTree as ConditionGroup, data)) continue;

      let execution;
      try {
        execution = await prisma.ruleExecution.create({
          data: { ruleId: rule.id, registrantId: registrant.id, status: "PENDING" },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          continue; // already handled by a previous/concurrent tick
        }
        throw err;
      }

      const body = interpolateTemplate(rule.messageTemplate, { displayName: registrant.displayName, data });

      await prisma.messageJob.create({
        data: {
          registrantId: registrant.id,
          channelId: registrant.channelId!,
          source: "RULE",
          ruleExecutionId: execution.id,
          body,
        },
      });
      matched++;
    }
  }

  return { rulesEvaluated: rules.length, matched };
}
