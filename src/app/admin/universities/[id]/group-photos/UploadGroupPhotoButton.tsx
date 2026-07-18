"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadLargePhoto, measureImageDimensions } from "@/lib/groupPhoto/uploadLargePhoto";
import { createGroupPhoto } from "@/lib/actions/groupPhotos";

export function UploadGroupPhotoButton({
  universityId,
  photoEventId,
}: {
  universityId: string;
  photoEventId: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const router = useRouter();

  async function handleFile(file: File) {
    const name = window.prompt("ตั้งชื่อรูปนี้ (เช่น ชื่อคณะ):", file.name.replace(/\.[^.]+$/, ""));
    if (!name || !name.trim()) return;

    setProgress(0);
    try {
      const { width, height } = await measureImageDimensions(file);
      const { url } = await uploadLargePhoto(universityId, file, setProgress);
      await createGroupPhoto(universityId, photoEventId, { name: name.trim(), imageUrl: url, imageWidth: width, imageHeight: height });
      router.refresh();
    } catch (err) {
      window.alert(`อัปโหลดไม่สำเร็จ: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={progress !== null}
        className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {progress !== null ? `กำลังอัปโหลด... ${progress.toFixed(0)}%` : "อัปโหลดรูปหมู่"}
      </button>
    </div>
  );
}
