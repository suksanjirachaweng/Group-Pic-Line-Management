import { upload } from "@vercel/blob/client";

/** Client-direct upload to Blob (bypasses the Next.js server function body entirely). */
export async function uploadLargePhoto(
  universityId: string,
  file: File,
  onProgress?: (percentage: number) => void,
): Promise<{ url: string }> {
  const result = await upload(`universities/${universityId}/group-photos/${file.name}`, file, {
    access: "public",
    handleUploadUrl: `/api/admin/universities/${universityId}/group-photos/upload`,
    contentType: file.type,
    onUploadProgress: onProgress ? (p) => onProgress(p.percentage) : undefined,
  });
  return { url: result.url };
}

/** Measures native pixel dimensions from the local File, without re-fetching the uploaded blob. */
export async function measureImageDimensions(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const dims = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dims;
}
