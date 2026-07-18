"use client";

import { useActionState, useState } from "react";
import { bulkSetDeliveryStatus, type BulkDeliveryStatusState } from "@/lib/actions/registrants";
import { DeliveryStatus } from "@/generated/prisma/enums";

const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  REGISTERED: "ลงทะเบียนแล้ว",
  PHOTO_ORDERED: "สั่งจองรูปแล้ว",
  PHOTO_RECEIVED: "ได้รับรูปแล้ว",
  NO_SHOW: "ยกเลิกไม่เข้ารับ",
  OTHER: "อื่นๆ",
};

/**
 * Bulk-sets delivery status for whatever's checked in the registrants list's shared select-form —
 * a sibling to BulkSendButton, reading the exact same `registrantIds` checkboxes, since setting
 * status and messaging are two separate admin intents that just happen to share the same
 * "select some rows first" UI.
 */
export function BulkDeliveryStatusButton({ universityId, selectFormId }: { universityId: string; selectFormId: string }) {
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [status, setStatus] = useState<DeliveryStatus>(DeliveryStatus.PHOTO_ORDERED);

  const [, formAction, isPending] = useActionState<BulkDeliveryStatusState, FormData>(async (prevState, formData) => {
    const result = await bulkSetDeliveryStatus(universityId, prevState, formData);
    if (result?.success) {
      window.alert(`ตั้งสถานะ "${DELIVERY_STATUS_LABEL[status]}" ให้ ${result.count} คนแล้ว`);
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
    setOpen(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        ตั้งสถานะการรับรูป
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
            <h3 className="mb-3 text-sm font-semibold text-gray-900">
              ตั้งสถานะการรับรูปให้ {selectedIds.length} คนที่เลือก
            </h3>

            <select
              name="deliveryStatus"
              value={status}
              onChange={(e) => setStatus(e.target.value as DeliveryStatus)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              {Object.values(DeliveryStatus).map((s) => (
                <option key={s} value={s}>
                  {DELIVERY_STATUS_LABEL[s]}
                </option>
              ))}
            </select>

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
                {isPending ? "กำลังบันทึก..." : "ยืนยัน"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
