"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { importGroupPhotoTagsFromMarkFile } from "@/lib/actions/groupPhotos";

export function ImportMarkFileButton({ universityId, groupPhotoId }: { universityId: string; groupPhotoId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, setIsPending] = useState(false);
  const router = useRouter();

  async function handleFile(file: File) {
    if (
      !window.confirm(
        'นำเข้าไฟล์นี้จะ "แทนที่" แท็กทั้งหมดที่มีอยู่ในรูปนี้ด้วยตำแหน่งจากไฟล์ (ชื่อ-นามสกุล, CODE, แถว, ลำดับ, X, Y) ยืนยันไหม?',
      )
    ) {
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setIsPending(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const result = await importGroupPhotoTagsFromMarkFile(universityId, groupPhotoId, null, formData);
      if (result && "error" in result) {
        window.alert(`นำเข้าไม่สำเร็จ: ${result.error}`);
      } else if (result) {
        window.alert(`นำเข้าแท็กสำเร็จ ${result.count} รายการ`);
        router.refresh();
      }
    } finally {
      setIsPending(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={isPending}
        className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {isPending ? "กำลังนำเข้า..." : "นำเข้า mark file"}
      </button>
    </div>
  );
}
