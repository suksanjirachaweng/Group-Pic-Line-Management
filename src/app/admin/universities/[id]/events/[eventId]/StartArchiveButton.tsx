"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { startPhotoEventArchive } from "@/lib/actions/photoEventArchive";

export function StartArchiveButton({ universityId, photoEventId }: { universityId: string; photoEventId: string }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (
          !window.confirm(
            "เริ่มสำรองข้อมูลงานนี้? ระบบจะบันทึกข้อมูลทั้งหมดและรูปภาพลงไฟล์สำรอง — ยังไม่ลบข้อมูลจนกว่าจะกดยืนยันลบอีกครั้งหลังตรวจสอบไฟล์แล้ว",
          )
        )
          return;
        startTransition(async () => {
          const result = await startPhotoEventArchive(universityId, photoEventId);
          if (result && "error" in result) window.alert(result.error);
          router.refresh();
        });
      }}
      className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
    >
      {isPending ? "กำลังเริ่ม..." : "ปิดงาน / สำรองข้อมูล"}
    </button>
  );
}
