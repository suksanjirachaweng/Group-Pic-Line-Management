"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmDeletePhotoEventData } from "@/lib/actions/photoEventArchive";

export function DeleteEventDataButton({
  universityId,
  photoEventId,
  eventCode,
}: {
  universityId: string;
  photoEventId: string;
  eventCode: string;
}) {
  const [open, setOpen] = useState(false);
  const [typedCode, setTypedCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
      >
        ลบข้อมูลออกจากระบบ
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
        <h3 className="mb-2 text-sm font-semibold text-red-700">ยืนยันการลบข้อมูลงาน &quot;{eventCode}&quot;</h3>
        <p className="mb-3 text-xs text-gray-500">
          จะลบผู้ลงทะเบียน รูปหมู่ แท็ก และประวัติทั้งหมดของงานนี้ออกจากฐานข้อมูลถาวร (ไฟล์สำรองที่บันทึกไว้แล้วยังอยู่ และกู้คืนได้ภายหลัง)
          พิมพ์ <span className="font-mono font-semibold">{eventCode}</span> เพื่อยืนยัน
        </p>
        <input
          type="text"
          value={typedCode}
          onChange={(e) => setTypedCode(e.target.value)}
          placeholder={eventCode}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={typedCode.trim() !== eventCode || isPending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await confirmDeletePhotoEventData(universityId, photoEventId, typedCode);
                if (result && "error" in result) {
                  setError(result.error);
                  return;
                }
                setOpen(false);
                router.refresh();
              });
            }}
            className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {isPending ? "กำลังลบ..." : "ลบถาวร"}
          </button>
        </div>
      </div>
    </div>
  );
}
