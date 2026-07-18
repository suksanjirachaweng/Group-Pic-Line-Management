import "server-only";
import { createHmac } from "node:crypto";

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes — long enough to start an upload on a slow connection

export function isPcPhotoServerConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_PC_PHOTO_STORAGE_URL && process.env.PC_PHOTO_STORAGE_SECRET);
}

/**
 * Mints a short-lived, HMAC-signed token for the self-hosted PC photo server — the shared secret
 * itself never leaves this process, only this time-boxed token. The PC server verifies the exact
 * same signature scheme (see pc-photo-server/server.js's verifyToken). No session/auth check here
 * — callers that need one (e.g. a browser-initiated upload) gate it themselves before calling this
 * (see getPcUploadToken); trusted server-side/cron callers (e.g. the close-out face-backup
 * trigger) call this directly.
 */
export function mintPcPhotoServerToken(): { baseUrl: string; token: string } {
  const baseUrl = process.env.NEXT_PUBLIC_PC_PHOTO_STORAGE_URL;
  const secret = process.env.PC_PHOTO_STORAGE_SECRET;
  if (!baseUrl || !secret) throw new Error("PC photo storage is not configured (missing env vars)");

  const expiry = Date.now() + TOKEN_TTL_MS;
  const signature = createHmac("sha256", secret).update(String(expiry)).digest("hex");
  return { baseUrl: baseUrl.replace(/\/+$/, ""), token: `${expiry}.${signature}` };
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
