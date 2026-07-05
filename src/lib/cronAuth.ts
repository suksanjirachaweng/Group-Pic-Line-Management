import "server-only";
import type { NextRequest } from "next/server";

/** Vercel Cron sends this as an Authorization: Bearer header when CRON_SECRET is configured. */
export function isAuthorizedCronRequest(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret configured (e.g. local dev) — allow
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
