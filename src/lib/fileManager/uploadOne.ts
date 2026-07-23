import { getUploadTarget } from "@/lib/actions/fileManager";

const MAX_RETRIES = 5; // bounds the failIfExists collision-retry loop below

/** Raw direct-to-PC-server XHR upload — bypasses the Next.js server function body entirely, same
 * pattern as uploadLargePhoto.ts's uploadToPcStorage. Retries on 409 (name collision from a
 * concurrent upload racing the same computed name) by re-asking the server action for a fresh
 * collision-safe name, bounded to MAX_RETRIES so a persistent server error can't loop forever.
 * Shared between the click-to-upload button and drag-and-drop so both go through one code path. */
export async function uploadOne(
  currentPath: string,
  file: File,
  onProgress: (pct: number) => void,
  attempt = 0,
): Promise<void> {
  const { uploadUrl, token, finalPath } = await getUploadTarget(currentPath, file.name);

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${uploadUrl}?path=${encodeURIComponent(finalPath)}&exact=1&failIfExists=1`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress((e.loaded / e.total) * 100);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      if (xhr.status === 409) return reject(new Error("COLLISION"));
      reject(new Error(`อัปโหลดไม่สำเร็จ (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("การเชื่อมต่อกับเซิร์ฟเวอร์จัดเก็บไฟล์ล้มเหลว"));
    xhr.send(file);
  }).catch(async (err: Error) => {
    if (err.message === "COLLISION" && attempt < MAX_RETRIES) {
      return uploadOne(currentPath, file, onProgress, attempt + 1);
    }
    throw err;
  });
}
