"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPhotoEventLiffVisibility } from "@/lib/actions/photoEvents";

/** Small on/off toggle for PhotoEvent.hiddenFromLiff — see the action's own doc comment for why
 * this is separate from the archive-lifecycle status. */
export function ToggleLiffVisibilityButton({
  universityId,
  photoEventId,
  hiddenFromLiff,
}: {
  universityId: string;
  photoEventId: string;
  hiddenFromLiff: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    setError(null);
    startTransition(async () => {
      try {
        await setPhotoEventLiffVisibility(universityId, photoEventId, !hiddenFromLiff);
        router.refresh();
      } catch {
        setError("บันทึกไม่สำเร็จ");
      }
    });
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={toggle}
        disabled={isPending}
        className={`rounded px-1.5 py-0.5 text-xs font-medium disabled:opacity-50 ${
          hiddenFromLiff ? "bg-gray-100 text-gray-500 hover:bg-gray-200" : "bg-green-100 text-green-700 hover:bg-green-200"
        }`}
        title="เปิด/ปิดการแสดงในหน้ารายการลงทะเบียนของนักศึกษาใน LINE (ไม่ลบข้อมูลใดๆ)"
      >
        {isPending ? "กำลังบันทึก..." : hiddenFromLiff ? "ซ่อนจากหน้า LINE" : "แสดงในหน้า LINE"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
