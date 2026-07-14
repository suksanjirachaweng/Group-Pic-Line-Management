"use server";

import { prisma } from "@/lib/prisma";
import { requireUniversityAccess } from "@/lib/authz";

export type UnregisteredFollower = {
  id: string;
  lineUserId: string;
  displayName: string | null;
  pictureUrl: string | null;
  followedAt: string;
  channelName: string;
};

/**
 * LINE users who added one of this university's active pool channels as a friend but never
 * completed registration for this university (so they have no `Registrant` row here) — a follow
 * event alone never creates one; it only exists once someone submits the registration form.
 *
 * A channel can serve multiple universities, so "unregistered" is computed per-university: if the
 * same person is a friend of a shared channel and has already registered for a DIFFERENT
 * university sharing that channel, they still show up here (correctly — they haven't registered
 * for THIS one yet).
 */
export async function getUnregisteredFollowers(universityId: string): Promise<UnregisteredFollower[]> {
  await requireUniversityAccess(universityId);

  const pool = await prisma.universityChannelPool.findMany({
    where: { universityId, isActive: true },
    select: { channelId: true },
  });
  const channelIds = pool.map((p) => p.channelId);
  if (channelIds.length === 0) return [];

  const [followers, registrants] = await Promise.all([
    prisma.lineFollower.findMany({
      where: { channelId: { in: channelIds }, unfollowedAt: null },
      include: { channel: { select: { name: true } } },
      orderBy: { followedAt: "desc" },
    }),
    prisma.registrant.findMany({
      where: { universityId, lineUserId: { not: null } },
      select: { lineUserId: true },
    }),
  ]);

  const registeredLineUserIds = new Set(registrants.map((r) => r.lineUserId));

  return followers
    .filter((f) => !registeredLineUserIds.has(f.lineUserId))
    .map((f) => ({
      id: f.id,
      lineUserId: f.lineUserId,
      displayName: f.displayName,
      pictureUrl: f.pictureUrl,
      followedAt: f.followedAt.toISOString(),
      channelName: f.channel.name,
    }));
}
