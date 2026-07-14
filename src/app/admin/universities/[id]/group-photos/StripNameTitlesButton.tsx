"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { stripLegacyReferenceNameTitles } from "@/lib/actions/groupPhotoLegacyReferences";

/**
 * Retroactively cleans up name-title prefixes (นาย/นาง/นางสาว/Mr./etc) on every existing
 * legacy-reference row — for data imported before that stripping existed at import time. Only
 * affects `GroupPhotoLegacyReference` rows (Excel/Google Sheet imports); LINE-sourced names come
 * live from each person's own LINE profile and are never touched.
 */
export function StripNameTitlesButton({ universityId }: { universityId: string }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (
          !window.confirm(
            "ลบคำนำหน้าชื่อที่ไม่จำเป็น (นาย/นาง/นางสาว/Mr./ฯลฯ) ออกจากข้อมูลที่นำเข้าไว้แล้วทั้งหมด? คำนำหน้าที่มีความหมาย เช่น นพ./ผศ./ดร./พล.อ. จะไม่ถูกแตะต้อง",
          )
        )
          return;
        startTransition(async () => {
          const { changed } = await stripLegacyReferenceNameTitles(universityId);
          window.alert(changed > 0 ? `ลบคำนำหน้าชื่อไปแล้ว ${changed} รายการ` : "ไม่พบคำนำหน้าชื่อที่ต้องลบ");
          router.refresh();
        });
      }}
      className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-50"
    >
      {isPending ? "กำลังลบ..." : "ลบคำนำหน้าชื่อ"}
    </button>
  );
}
