"use client";

import { useActionState, useState } from "react";
import { bulkMoveRegistrantsToEvent, type BulkMoveEventState } from "@/lib/actions/registrants";
import type { PhotoEventListItem } from "@/lib/actions/photoEvents";

/**
 * Manual override for which PhotoEvent the selected registrants belong to — a sibling to
 * BulkDeliveryStatusButton, reading the same shared `registrantIds` checkboxes. Exists because
 * photoEventId is otherwise only ever set automatically (bootstrap-then-stick matching), with no
 * way for an admin to fix a mis-assigned registrant when two events' code ranges/dates overlap.
 */
export function BulkMoveEventButton({
  universityId,
  selectFormId,
  events,
}: {
  universityId: string;
  selectFormId: string;
  events: PhotoEventListItem[];
}) {
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [photoEventId, setPhotoEventId] = useState(events[0]?.id ?? "");

  const [, formAction, isPending] = useActionState<BulkMoveEventState, FormData>(async (prevState, formData) => {
    const result = await bulkMoveRegistrantsToEvent(universityId, prevState, formData);
    if (result?.success) {
      window.alert(`ย้าย ${result.count} คนไป event นี้แล้ว`);
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

  if (events.length < 2) return null; // nothing to move between with 0-1 events

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="rounded-md border border-green-300 px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-50"
      >
        ย้าย event
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
              ย้าย {selectedIds.length} คนที่เลือกไป event
            </h3>

            <select
              name="photoEventId"
              value={photoEventId}
              onChange={(e) => setPhotoEventId(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.label ? `${ev.code} — ${ev.label}` : ev.code}
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
                className="rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                {isPending ? "กำลังย้าย..." : "ยืนยัน"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
