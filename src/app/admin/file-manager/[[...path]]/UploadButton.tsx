"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getUploadTarget } from "@/lib/actions/fileManager";

const MAX_RETRIES = 5; // bounds the failIfExists collision-retry loop — see uploadOne's own comment

/** Raw direct-to-PC-server XHR upload — bypasses the Next.js server function body entirely, same
 * pattern as uploadLargePhoto.ts's uploadToPcStorage. Retries on 409 (name collision from a
 * concurrent upload racing the same computed name) by re-asking the server action for a fresh
 * collision-safe name, bounded to MAX_RETRIES so a persistent server error can't loop forever. */
async function uploadOne(
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

export function UploadButton({ currentPath }: { currentPath: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ name: string; pct: number } | null>(null);

  async function handleFiles(files: FileList) {
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        setProgress({ name: file.name, pct: 0 });
        await uploadOne(currentPath, file, (pct) => setProgress({ name: file.name, pct }));
      }
      router.refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "อัปโหลดไม่สำเร็จ");
    } finally {
      setUploading(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) void handleFiles(e.target.files);
        }}
      />
      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {uploading
          ? progress
            ? `กำลังอัปโหลด ${progress.name} (${Math.round(progress.pct)}%)`
            : "กำลังอัปโหลด..."
          : "อัปโหลดไฟล์"}
      </button>
    </>
  );
}
