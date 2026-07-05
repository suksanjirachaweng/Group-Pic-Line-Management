import "server-only";
import { prisma } from "@/lib/prisma";

export function currentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Picks the active pool channel for a university with the most free-tier headroom
 * this month (lowest messagesSent / monthlyFreeQuota ratio), tie-broken by channel id
 * for stability. Returns null if the university has no active pool channels.
 */
export async function pickChannelForUniversity(universityId: string) {
  const yearMonth = currentYearMonth();

  const pool = await prisma.universityChannelPool.findMany({
    where: { universityId, isActive: true, channel: { isActive: true } },
    include: {
      channel: {
        include: { usageCounters: { where: { yearMonth } } },
      },
    },
  });

  if (pool.length === 0) return null;

  const candidates = pool.map((p) => {
    const used = p.channel.usageCounters[0]?.messagesSent ?? 0;
    const ratio = used / p.channel.monthlyFreeQuota;
    return { channel: p.channel, ratio };
  });

  candidates.sort((a, b) => a.ratio - b.ratio || a.channel.id.localeCompare(b.channel.id));

  return candidates[0].channel;
}
