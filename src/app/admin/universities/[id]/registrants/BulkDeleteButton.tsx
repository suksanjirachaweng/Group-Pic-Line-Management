"use client";

import { useActionState, useState } from "react";
import { bulkDeleteRegistrants, type BulkDeleteState } from "@/lib/actions/registrants";

/**
 * Deletes whatever's checked in the shared `registrantIds` checkboxes — gated by an explicit
 * confirm dialog (irreversible), and by the server action's own refusal to delete anyone already
 * linked to a GroupPhotoTag. Reads the blocked/skipped list back from the action's result rather
 * than pre-checking client-side, since "linked to a tag" can only be answered server-side.
 */
export function BulkDeleteButton({
  universityId,
  selectFormId,
}: {
  universityId: string;
  selectFormId: string;
}) {
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [, formAction, isPending] = useActionState<BulkDeleteState, FormData>(async (prevState, formData) => {
    const result = await bulkDeleteRegistrants(universityId, prevState, formData);
    if (result?.success) {
      setOpen(false);
      if (result.skipped.length > 0) {
        const list = result.skipped.map((s) => `- ${s.name}${s.code ? ` (${s.code})` : ""}`).join("\n");
        window.alert(
          `ลบแล้ว ${result.count} คน\n\nลบไม่ได้ ${result.skipped.length} คน เพราะผูกกับ tag ในรูปหมู่อยู่แล้ว (ต้องลบ/แก้ tag ในรูปก่อน ถึงจะลบคนนี้ได้):\n${list}`,
        );
      } else {
        window.alert(`ลบแล้ว ${result.count} คน`);
      }
    } else if (result) {
      window.alert(`ไม่สำเร็จ: ${result.error}`);
    }
    return result;
  }, null);

  function handleOpen() {
    const form = document.getElementById(selectFormId) as HTMLFormElement | null;
    if (!form) return;
    const checked = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="registrantIds"]:checked'));
    if (checked.length === 0) {
      window.alert("ยังไม่ได้เลือกผู้รับ — ติ๊กเลือกรายชื่อในตารางก่อนครับ");
      return;
    }
    setSelectedIds(checked.map((c) => c.value));
    setOpen(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
      >
        ลบ
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <form
            action={formAction}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl"
          >
            {selectedIds.map((id) => (
              <input key={id} type="hidden" name="registrantIds" value={id} />
            ))}
            <h3 className="mb-2 text-sm font-semibold text-gray-900">
              ลบ {selectedIds.length} คนที่เลือก?
            </h3>
            <p className="mb-4 text-sm text-gray-600">
              การลบนี้ย้อนกลับไม่ได้ — คนที่ผูกกับ tag ในรูปหมู่อยู่แล้วจะไม่ถูกลบ ระบบจะแจ้งรายชื่อให้หลังกดยืนยัน
            </p>

            <div className="flex justify-end gap-2">
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
                {isPending ? "กำลังลบ..." : "ยืนยันลบ"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
