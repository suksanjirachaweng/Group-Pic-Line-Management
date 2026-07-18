"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { startFaceBankBuild } from "@/lib/actions/photoEventArchive";

export function BuildFaceBankButton({ universityId, photoEventId }: { universityId: string; photoEventId: string }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (
          !window.confirm(
            'ครอบตัดใบหน้าจากทุกแท็กแถวหน้า (แถว 0) ที่มีชื่อและไม่มีปัญหาค้างอยู่ ส่งไปคำนวณค่าเปรียบเทียบแล้วเก็บเข้าคลังใบหน้า — ไม่ลบหรือแก้ไขข้อมูลอื่นของ event นี้เลย ไม่ต้องปิดงาน/สำรองข้อมูลก่อน',
          )
        )
          return;
        startTransition(async () => {
          const result = await startFaceBankBuild(universityId, photoEventId);
          if (result && "error" in result) window.alert(result.error);
          router.refresh();
        });
      }}
      className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
    >
      {isPending ? "กำลังเริ่ม..." : "ดึงเข้าคลังใบหน้า"}
    </button>
  );
}
