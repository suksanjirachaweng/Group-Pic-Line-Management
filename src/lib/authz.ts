import "server-only";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { AdminRole } from "@/generated/prisma/enums";
import { canAccessUniversity } from "@/lib/auth";

export class AuthzError extends Error {}

/** Throws if there's no signed-in admin. Use in server actions (pages are gated by proxy.ts). */
export async function requireSession() {
  const session = await getServerSession(authOptions);
  if (!session) throw new AuthzError("Not signed in");
  return session;
}

/** Throws unless the signed-in admin is a superadmin. */
export async function requireSuperadmin() {
  const session = await requireSession();
  if (session.user.role !== AdminRole.SUPERADMIN) {
    throw new AuthzError("Superadmin only");
  }
  return session;
}

/** Throws unless the signed-in admin can access the given university (superadmin, or assigned). */
export async function requireUniversityAccess(universityId: string) {
  const session = await requireSession();
  if (!canAccessUniversity(session.user, universityId)) {
    throw new AuthzError("No access to this university");
  }
  return session;
}
