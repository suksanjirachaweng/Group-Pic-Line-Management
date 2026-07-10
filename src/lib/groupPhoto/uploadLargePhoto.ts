import { upload } from "@vercel/blob/client";
import { getPcUploadToken } from "@/lib/actions/pcPhotoStorage";

// Set NEXT_PUBLIC_PC_PHOTO_STORAGE_URL to switch every group-photo upload over to the
// self-hosted PC server instead of Vercel Blob — no other code needs to change, `imageUrl` is
// just a plain string either way.
const PC_STORAGE_BASE_URL = process.env.NEXT_PUBLIC_PC_PHOTO_STORAGE_URL;

/** Client-direct upload — bypasses the Next.js server function body entirely either way. */
export async function uploadLargePhoto(
  universityId: string,
  file: File,
  onProgress?: (percentage: number) => void,
): Promise<{ url: string }> {
  if (PC_STORAGE_BASE_URL) {
    return uploadToPcStorage(universityId, file, onProgress);
  }
  const result = await upload(`universities/${universityId}/group-photos/${file.name}`, file, {
    access: "public",
    handleUploadUrl: `/api/admin/universities/${universityId}/group-photos/upload`,
    contentType: file.type,
    onUploadProgress: onProgress ? (p) => onProgress(p.percentage) : undefined,
  });
  return { url: result.url };
}

async function uploadToPcStorage(
  universityId: string,
  file: File,
  onProgress?: (percentage: number) => void,
): Promise<{ url: string }> {
  const { uploadUrl, token } = await getPcUploadToken(universityId);
  const path = `universities/${universityId}/group-photos/${file.name}`;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${uploadUrl}/upload?path=${encodeURIComponent(path)}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable) onProgress((e.loaded / e.total) * 100);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("Invalid response from photo server"));
        }
      } else {
        reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText}`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error uploading to the photo server"));
    xhr.send(file);
  });
}

/** Measures native pixel dimensions from the local File, without re-fetching the uploaded blob. */
export async function measureImageDimensions(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const dims = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dims;
}
