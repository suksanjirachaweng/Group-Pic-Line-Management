"use client";

import { useActionState, useState } from "react";
import { mergeDuplicateRegistrants, type MergeDuplicatesState } from "@/lib/actions/registrants";

/**
 * One-time cleanup for registrants that already got duplicated before /api/register started
 * preventing it (same LINE user, identical name+code+phone+photoEventId) — see
 * registrantDedupe.ts. Deletes real rows, so this is an explicit confirm-first action, not
 * something that runs on its own.
 */
export function MergeDuplicatesButton({ universityId }: { universityId: string }) {
  const [open, setOpen] = useState(false);
  const [, formAction, isPending] = useActionState<MergeDuplicatesState, FormData>(async (prevState) => {
    const result = await mergeDuplicateRegistrants(universityId, prevState);
    if (result?.success) {
      window.alert(
        result.registrantsMerged > 0
          ? `รวมรายการซ้ำแล้ว ${result.registrantsMerged} รายการ (จาก ${result.groupsFound} กลุ่มที่ซ้ำ)`
          : "ไม่พบรายการซ้ำครับ",
      );
      setOpen(false);
    } else if (result) {
      window.alert(`ไม่สำเร็จ: ${result.error}`);
    }
    return result;
  }, null);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        รวมรายการซ้ำ
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <form
            action={formAction}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl"
          >
            <h3 className="mb-2 text-sm font-semibold text-gray-900">รวมรายการลงทะเบียนซ้ำ</h3>
            <p className="text-xs text-gray-500">
              ค้นหารายการของ LINE user เดียวกันที่มีชื่อ-นามสกุล หมายเลขรูปหมู่ เบอร์โทร และ event
              ตรงกันทุกอย่าง แล้วรวมเหลือรายการเดียว (เก็บรายการที่ลงทะเบียนก่อน) —
              ลบรายการที่เหลือถาวร ย้อนกลับไม่ได้
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {isPending ? "กำลังรวม..." : "ยืนยันรวมรายการซ้ำ"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
