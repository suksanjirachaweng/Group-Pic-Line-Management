/**
 * LINE Official Account Manager monthly plan tiers, as observed live in the console
 * (manager.line.biz > Monthly plan). These numbers are known to change over time —
 * this is only used for the admin's cost-projection dashboard, not for any billing
 * logic; the actual enforced quota/overage behavior is per-channel and admin-configurable
 * (Channel.monthlyFreeQuota / allowOverage).
 */
export const LINE_PLAN_TIERS = [
  { name: "Free", monthlyFee: 0, freeMessages: 300, overageAllowed: false, overagePerMessage: 0 },
  { name: "Basic", monthlyFee: 1280, freeMessages: 15_000, overageAllowed: true, overagePerMessage: 0.1 },
  { name: "Pro", monthlyFee: 1780, freeMessages: 35_000, overageAllowed: true, overagePerMessage: 0.06 },
] as const;

export type PlanProjection = {
  name: string;
  monthlyFee: number;
  projectedCost: number | null; // null if this plan can't support the volume at all (Free, over quota)
};

/** Projects the monthly cost of the given usage volume under each known plan tier. */
export function projectCostForAllTiers(messagesThisMonth: number): PlanProjection[] {
  return LINE_PLAN_TIERS.map((tier) => {
    if (messagesThisMonth <= tier.freeMessages) {
      return { name: tier.name, monthlyFee: tier.monthlyFee, projectedCost: tier.monthlyFee };
    }
    if (!tier.overageAllowed) {
      return { name: tier.name, monthlyFee: tier.monthlyFee, projectedCost: null };
    }
    const overage = (messagesThisMonth - tier.freeMessages) * tier.overagePerMessage;
    return { name: tier.name, monthlyFee: tier.monthlyFee, projectedCost: tier.monthlyFee + overage };
  });
}

/** Picks the cheapest plan that can actually support the given monthly volume. */
export function cheapestViablePlan(messagesThisMonth: number): PlanProjection {
  const viable = projectCostForAllTiers(messagesThisMonth).filter((p) => p.projectedCost !== null);
  return viable.reduce((best, p) => (p.projectedCost! < best.projectedCost! ? p : best));
}
