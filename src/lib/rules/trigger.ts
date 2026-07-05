import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { matchesConditionTree, interpolateTemplate, type ConditionGroup } from "@/lib/rules/evaluate";

/**
 * Evaluates all active ON_REGISTRATION rules for a registrant's university and enqueues
 * MessageJobs for matches. Idempotent: relies on the (ruleId, registrantId) unique
 * constraint on RuleExecution — a concurrent duplicate call will hit P2002 and skip,
 * never double-sending.
 */
export async function evaluateOnRegistrationRules(registrantId: string): Promise<void> {
  const registrant = await prisma.registrant.findUnique({ where: { id: registrantId } });
  if (!registrant || !registrant.channelId) return;

  const rules = await prisma.rule.findMany({
    where: { universityId: registrant.universityId, isActive: true, trigger: "ON_REGISTRATION" },
  });

  const data = registrant.data as Record<string, unknown>;

  for (const rule of rules) {
    if (!matchesConditionTree(rule.conditionTree as ConditionGroup, data)) continue;

    let execution;
    try {
      execution = await prisma.ruleExecution.create({
        data: { ruleId: rule.id, registrantId: registrant.id, status: "PENDING" },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        continue; // already handled by a previous/concurrent evaluation
      }
      throw err;
    }

    const body = interpolateTemplate(rule.messageTemplate, {
      displayName: registrant.displayName,
      data,
    });

    await prisma.messageJob.create({
      data: {
        registrantId: registrant.id,
        channelId: registrant.channelId,
        source: "RULE",
        ruleExecutionId: execution.id,
        body,
      },
    });
  }
}
