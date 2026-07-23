import "server-only";
import { createHmac } from "node:crypto";

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes — long enough to start an upload on a slow connection

export function isPcPhotoServerConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_PC_PHOTO_STORAGE_URL && process.env.PC_PHOTO_STORAGE_SECRET);
}

export type PcPhotoServerTokenOptions = {
  /**
   * Restricts the token to paths equal to or nested under this prefix (e.g. `"filemanager/abc"`).
   * Only meaningful together with `uploadOnly: true` — see that field's own doc comment.
   */
  scope?: string;
  /**
   * Set `true` for ANY token that will be sent to a browser — admin or anonymous share visitor
   * alike. An `uploadOnly` token is only accepted by the PC server's `/upload` route; every other
   * route (list/mkdir/rename/move/delete/disk-space) explicitly rejects it even if the scope would
   * otherwise match. Without this, handing a scoped-but-full-access token to an anonymous
   * "dropbox" visitor would let them delete/rename/move other files already sitting in that same
   * shared folder, not just upload their own — this flag is what closes that gap. Trusted
   * server-to-server callers (list/mkdir/rename/move/disk-space, all called directly from a
   * `"use server"` action, never serialized to a client) must never set this — they use the
   * default omitted-`opts` call instead.
   */
  uploadOnly?: boolean;
};

/**
 * Mints a short-lived, HMAC-signed token for the self-hosted PC photo server — the shared secret
 * itself never leaves this process, only this time-boxed token. The PC server verifies the exact
 * same signature scheme (see pc-photo-server/server.js's verifyToken). No session/auth check here
 * — callers that need one (e.g. a browser-initiated upload) gate it themselves before calling this
 * (see getPcUploadToken); trusted server-side/cron callers (e.g. the close-out face-backup
 * trigger) call this directly.
 *
 * Called with no `opts` (the original, still-default shape): produces the exact same 2-part
 * `"<expiry>.<sig>"` token every existing caller (`embedFace`, the archive close-out job, the
 * group-photo uploader) has always gotten — byte-for-byte unchanged, zero behavior change for any
 * of them. Only callers that pass `opts` (the file-manager feature) get the newer 3-part
 * `"<expiry>.<claimsB64url>.<sig>"` scoped format — see pc-photo-server/server.js's `verifyToken`
 * for the exact parsing/verification counterpart.
 */
export function mintPcPhotoServerToken(opts?: PcPhotoServerTokenOptions): { baseUrl: string; token: string } {
  const baseUrl = process.env.NEXT_PUBLIC_PC_PHOTO_STORAGE_URL;
  const secret = process.env.PC_PHOTO_STORAGE_SECRET;
  if (!baseUrl || !secret) throw new Error("PC photo storage is not configured (missing env vars)");

  const expiry = Date.now() + TOKEN_TTL_MS;

  if (!opts) {
    const signature = createHmac("sha256", secret).update(String(expiry)).digest("hex");
    return { baseUrl: baseUrl.replace(/\/+$/, ""), token: `${expiry}.${signature}` };
  }

  const claims = { scope: opts.scope ?? null, uploadOnly: Boolean(opts.uploadOnly) };
  const claimsB64 = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(`${expiry}.${claimsB64}`).digest("hex");
  return { baseUrl: baseUrl.replace(/\/+$/, ""), token: `${expiry}.${claimsB64}.${signature}` };
}

// Same reasoning as EMBED_FACE_TIMEOUT_MS below — this is a real PC, not managed infra, so
// callers that are about to depend on it for something hard to reverse (e.g. starting an event
// close-out, which later gates permanently deleting the live data) should fail fast and loud
// up front rather than silently discovering mid-job that every image copy is failing.
const HEALTH_CHECK_TIMEOUT_MS = 5_000;

/** True only if PC photo storage is both configured AND actually reachable right now. */
export async function isPcPhotoServerReachable(): Promise<boolean> {
  if (!isPcPhotoServerConfigured()) return false;
  const baseUrl = process.env.NEXT_PUBLIC_PC_PHOTO_STORAGE_URL!.replace(/\/+$/, "");
  try {
    const resp = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS) });
    return resp.ok;
  } catch {
    return false;
  }
}

export type EmbedFaceResult = { embedding: number[]; score: number; cropUrl: string };

/**
 * Calls the self-hosted PC server's POST /embed-face with a face-crop image. Returns null (not a
 * thrown error) both when no confident face was found in the crop (422) and when PC photo storage
 * isn't configured at all — both are legitimate "nothing to do here" outcomes for callers like the
 * close-out face-backup trigger, which shouldn't fail a whole archive job over either case.
 */
// The PC server is a real physical machine in the studio, not managed infra — it can be asleep,
// powered off, or unreachable. Without a bounded timeout, an admin's face-search click could hang
// for however long the platform's own function timeout happens to be (found via a real
// "กำลังค้นหา..." that never resolved) instead of failing fast with a visible error.
const EMBED_FACE_TIMEOUT_MS = 20_000;

export async function embedFace(imageBuffer: Buffer): Promise<EmbedFaceResult | null> {
  if (!isPcPhotoServerConfigured()) return null;

  const { baseUrl, token } = mintPcPhotoServerToken();
  let resp: Response;
  try {
    resp = await fetch(`${baseUrl}/embed-face`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
      body: new Uint8Array(imageBuffer),
      signal: AbortSignal.timeout(EMBED_FACE_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error("PC server ไม่ตอบสนอง (เครื่องอาจปิดอยู่หรือไม่ได้เชื่อมต่ออินเทอร์เน็ต)");
    }
    throw err;
  }
  if (resp.status === 422) return null;
  if (!resp.ok) throw new Error(`PC server /embed-face failed (${resp.status})`);
  return resp.json();
}
