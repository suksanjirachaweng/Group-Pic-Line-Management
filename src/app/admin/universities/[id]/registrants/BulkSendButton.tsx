"use client";

import { useActionState, useState } from "react";
import { sendBulkMessage, type BulkSendState } from "@/lib/actions/messages";

export function BulkSendButton({ universityId, selectFormId }: { universityId: string; selectFormId: string }) {
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [hasImage, setHasImage] = useState(false);

  const [, formAction, isPending] = useActionState<BulkSendState, FormData>(async (prevState, formData) => {
    const result = await sendBulkMessage(universityId, prevState, formData);
    if (result?.success) {
      window.alert(`ส่งข้อความเข้าคิวให้ ${result.count} คนแล้ว (จะทยอยส่งจริงภายในไม่กี่นาที)`);
      setOpen(false);
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
    setHasImage(false);
    setOpen(true);
  }

  const quotaCost = selectedIds.length * (hasImage ? 2 : 1);

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
      >
        ส่งข้อความให้ที่เลือก
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <form
            action={formAction}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
          >
            {selectedIds.map((id) => (
              <input key={id} type="hidden" name="registrantIds" value={id} />
            ))}
            <h3 className="mb-3 text-sm font-semibold text-gray-900">ส่งข้อความให้ {selectedIds.length} คนที่เลือก</h3>

            <label className="block text-xs font-medium text-gray-700">
              ข้อความ (ใช้ {"{{full_name}}"} หรือ {"{{key}}"} ของ field อื่นแทนค่าได้)
            </label>
            <textarea
              name="body"
              required
              rows={4}
              placeholder="สวัสดีคุณ {{full_name}} ..."
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />

            <label className="mt-3 block text-xs font-medium text-gray-700">แนบรูป (ไม่บังคับ)</label>
            <input
              type="file"
              name="image"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => setHasImage(!!e.target.files?.length)}
              className="mt-1 w-full text-sm"
            />

            <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              จะส่งไปหา {selectedIds.length} คน — ใช้โควต้าประมาณ {quotaCost} ข้อความ
              {hasImage && " (รูป + ข้อความ นับ 2 ต่อคน)"}
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
                className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {isPending ? "กำลังส่ง..." : "ยืนยันส่ง"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
