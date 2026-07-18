"use server";

import { requireUniversityAccess } from "@/lib/authz";
import { mintPcPhotoServerToken } from "@/lib/pcPhotoServer";

/**
 * Mints a short-lived, HMAC-signed upload token for the self-hosted PC photo server — the shared
 * secret itself never reaches the browser, only this time-boxed token. The PC server verifies the
 * exact same signature scheme (see pc-photo-server/server.js). Session-gated the same way the
 * Vercel Blob upload route is, so only admins with access to this university can mint one.
 */
export async function getPcUploadToken(universityId: string): Promise<{ uploadUrl: string; token: string }> {
  await requireUniversityAccess(universityId);
  const { baseUrl, token } = mintPcPhotoServerToken();
  return { uploadUrl: baseUrl, token };
}
