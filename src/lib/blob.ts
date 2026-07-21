import "server-only";
import { put, del } from "@vercel/blob";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export async function uploadImage(file: File, pathPrefix: string): Promise<string> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error("Only PNG, JPEG, WEBP, or GIF images are allowed");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("Image must be smaller than 5MB");
  }

  const blob = await put(`${pathPrefix}/${file.name}`, file, {
    access: "public",
    addRandomSuffix: true,
  });

  return blob.url;
}

export async function deleteImage(url: string): Promise<void> {
  await del(url);
}

/**
 * Buffer-based upload for server contexts that already hold raw image bytes rather than a `File`
 * (e.g. a `sharp`-cropped tile inside the cron auto-tag job) — same storage/access semantics as
 * `uploadImage`, just without the `File`-specific size/type validation (the caller already knows
 * what it produced; these are internal OCR-tile crops, never user-supplied uploads).
 */
export async function uploadImageBuffer(
  buf: Buffer,
  filename: string,
  pathPrefix: string,
): Promise<string> {
  const blob = await put(`${pathPrefix}/${filename}`, buf, {
    access: "public",
    addRandomSuffix: true,
  });
  return blob.url;
}
