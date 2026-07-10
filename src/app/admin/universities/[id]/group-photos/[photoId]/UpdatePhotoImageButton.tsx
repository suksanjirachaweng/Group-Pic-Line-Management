"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadLargePhoto, measureImageDimensions } from "@/lib/groupPhoto/uploadLargePhoto";
import { updateGroupPhotoImage } from "@/lib/actions/groupPhotos";

export function UpdatePhotoImageButton({ universityId, groupPhotoId }: { universityId: string; groupPhotoId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const router = useRouter();

  async function handleFile(file: File) {
    if (
      !window.confirm(
        "แทนที่รูปนี้ด้วยไฟล์ใหม่? แท็กที่มีอยู่จะยังอยู่เหมือนเดิม แต่ตำแหน่งอาจเพี้ยนถ้ารูปใหม่ไม่ตรงกับรูปเดิม (ปรับได้ทีหลังด้วยปุ่ม \"ปรับตำแหน่งทั้งหมด\")",
      )
    ) {
      return;
    }

    setProgress(0);
    try {
      const { width, height } = await measureImageDimensions(file);
      const { url } = await uploadLargePhoto(universityId, file, setProgress);
      await updateGroupPhotoImage(universityId, groupPhotoId, { imageUrl: url, imageWidth: width, imageHeight: height });
      router.refresh();
    } catch (err) {
      window.alert(`อัปเดตรูปไม่สำเร็จ: ${err instanceof Error ? err.message : "unknown error"}`);
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
        className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {progress !== null ? `กำลังอัปโหลด... ${progress.toFixed(0)}%` : "อัปเดตรูปภาพ"}
      </button>
    </div>
  );
}
