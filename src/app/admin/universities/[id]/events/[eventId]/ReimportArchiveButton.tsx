"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { reimportPhotoEventArchiveAction } from "@/lib/actions/photoEventArchive";

export function ReimportArchiveButton({ universityId, photoEventId }: { universityId: string; photoEventId: string }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (!window.confirm("กู้คืนข้อมูลงานนี้จากไฟล์สำรอง? ระบบจะสร้างผู้ลงทะเบียน รูปหมู่ และแท็กทั้งหมดขึ้นใหม่ และเปิดงานนี้ให้ใช้งานได้อีกครั้ง"))
          return;
        startTransition(async () => {
          const result = await reimportPhotoEventArchiveAction(universityId, photoEventId);
          if (result && "error" in result) {
            window.alert(result.error);
          } else if (result) {
            window.alert(
              `กู้คืนสำเร็จ: ผู้ลงทะเบียน ${result.summary.registrants} คน, รูปหมู่ ${result.summary.groupPhotos} รูป, แท็ก ${result.summary.tags} รายการ, ข้อมูลอ้างอิงเดิม ${result.summary.legacyReferences} รายการ` +
                (result.summary.skippedMessageJobs + result.summary.skippedMessageLogs + result.summary.skippedRuleExecutions > 0
                  ? ` (ข้ามประวัติการส่งข้อความบางส่วนที่อ้างอิง LINE Channel/กฎที่ถูกลบไปแล้ว)`
                  : ""),
            );
          }
          router.refresh();
        });
      }}
      className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
    >
      {isPending ? "กำลังกู้คืน..." : "กู้คืนข้อมูล (Reimport)"}
    </button>
  );
}
