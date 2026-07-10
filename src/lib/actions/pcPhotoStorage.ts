"use server";

import { createHmac } from "node:crypto";
import { requireUniversityAccess } from "@/lib/authz";

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes — long enough to start an upload on a slow connection

/**
 * Mints a short-lived, HMAC-signed upload token for the self-hosted PC photo server — the shared
 * secret itself never reaches the browser, only this time-boxed token. The PC server verifies the
 * exact same signature scheme (see pc-photo-server/server.js). Session-gated the same way the
 * Vercel Blob upload route is, so only admins with access to this university can mint one.
 */
export async function getPcUploadToken(universityId: string): Promise<{ uploadUrl: string; token: string }> {
  await requireUniversityAccess(universityId);

  const baseUrl = process.env.NEXT_PUBLIC_PC_PHOTO_STORAGE_URL;
  const secret = process.env.PC_PHOTO_STORAGE_SECRET;
  if (!baseUrl || !secret) throw new Error("PC photo storage is not configured (missing env vars)");

  const expiry = Date.now() + TOKEN_TTL_MS;
  const signature = createHmac("sha256", secret).update(String(expiry)).digest("hex");
  return { uploadUrl: baseUrl.replace(/\/+$/, ""), token: `${expiry}.${signature}` };
}
