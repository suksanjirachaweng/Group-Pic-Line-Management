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
