"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { updatePhotoEvent, type UpdatePhotoEventState } from "@/lib/actions/photoEvents";

/** Formats a Date as the yyyy-MM-dd a native `<input type="date">` needs, in local time (not
 * UTC) — using toISOString() directly would shift the date back a day for timezones behind UTC. */
function toDateInputValue(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function EditPhotoEventForm({
  universityId,
  photoEventId,
  code,
  label,
  startDate,
  endDate,
  codeRangeMin,
  codeRangeMax,
}: {
  universityId: string;
  photoEventId: string;
  code: string;
  label: string | null;
  startDate: string;
  endDate: string;
  codeRangeMin: number | null;
  codeRangeMax: number | null;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const action = updatePhotoEvent.bind(null, universityId, photoEventId);

  const [state, formAction, isPending] = useActionState<UpdatePhotoEventState, FormData>(async (prev, formData) => {
    const result = await action(prev, formData);
    if (result && "success" in result) {
      setOpen(false);
      if (result.assignedCount > 0) {
        window.alert(`ผูก Registrants ที่ยังไม่มี event เข้ากับงานนี้เพิ่ม ${result.assignedCount} รายการ`);
      }
      router.refresh();
    }
    return result;
  }, null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        แก้ไขงานนี้
      </button>
    );
  }

  return (
    <form
      action={formAction}
      className="mb-6 flex flex-wrap items-end gap-3 rounded-md border border-indigo-200 bg-indigo-50 p-3"
    >
      <label className="flex-none text-xs text-gray-600">
        รหัสงาน (เช่น KKU67)
        <input
          type="text"
          name="code"
          required
          maxLength={40}
          defaultValue={code}
          className="mt-1 block w-32 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
        />
      </label>
      <label className="flex-1 min-w-[160px] text-xs text-gray-600">
        คำอธิบาย (ไม่บังคับ)
        <input
          type="text"
          name="label"
          maxLength={200}
          defaultValue={label ?? ""}
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
        />
      </label>
      <label className="flex-none text-xs text-gray-600">
        วันที่เริ่ม
        <input
          type="date"
          name="startDate"
          required
          defaultValue={toDateInputValue(new Date(startDate))}
          className="mt-1 block rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
        />
      </label>
      <label className="flex-none text-xs text-gray-600">
        วันที่สิ้นสุด
        <input
          type="date"
          name="endDate"
          required
          defaultValue={toDateInputValue(new Date(endDate))}
          className="mt-1 block rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
        />
      </label>
      <label className="flex-none text-xs text-gray-600">
        เลข CODE ต่ำสุด (ไม่บังคับ)
        <input
          type="number"
          name="codeRangeMin"
          defaultValue={codeRangeMin ?? ""}
          className="mt-1 block w-24 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
        />
      </label>
      <label className="flex-none text-xs text-gray-600">
        เลข CODE สูงสุด (ไม่บังคับ)
        <input
          type="number"
          name="codeRangeMax"
          defaultValue={codeRangeMax ?? ""}
          className="mt-1 block w-24 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
        />
      </label>
      <div className="ml-auto flex flex-none items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-white"
        >
          ยกเลิก
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {isPending ? "กำลังบันทึก..." : "บันทึก"}
        </button>
      </div>
      {state && "error" in state && <p className="w-full text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
