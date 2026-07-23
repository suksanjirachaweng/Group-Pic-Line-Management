"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadOne } from "@/lib/fileManager/uploadOne";

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
