"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { createPhotoEvent, type CreatePhotoEventState } from "@/lib/actions/photoEvents";

export function CreatePhotoEventForm({ universityId }: { universityId: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const action = createPhotoEvent.bind(null, universityId);

  const [state, formAction, isPending] = useActionState<CreatePhotoEventState, FormData>(async (prev, formData) => {
    const result = await action(prev, formData);
    if (result && "success" in result) {
      setOpen(false);
      router.refresh();
    }
    return result;
  }, null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
      >
        + สร้างงานใหม่
      </button>
    );
  }

  return (
    <form
      action={formAction}
      className="flex flex-wrap items-end gap-3 rounded-md border border-indigo-200 bg-indigo-50 p-3"
    >
      <label className="flex-none text-xs text-gray-600">
        รหัสงาน (เช่น KKU67)
        <input
          type="text"
          name="code"
          required
          maxLength={40}
          placeholder="KKU67"
          className="mt-1 block w-32 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
        />
      </label>
      <label className="flex-1 min-w-[160px] text-xs text-gray-600">
        คำอธิบาย (ไม่บังคับ)
        <input
          type="text"
          name="label"
          maxLength={200}
          placeholder="ปีการศึกษา 2567"
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
        />
      </label>
      <label className="flex-none text-xs text-gray-600">
        วันที่เริ่ม
        <input
          type="date"
          name="startDate"
          required
          className="mt-1 block rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
        />
      </label>
      <label className="flex-none text-xs text-gray-600">
        วันที่สิ้นสุด
        <input
          type="date"
          name="endDate"
          required
          className="mt-1 block rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
        />
      </label>
      <label className="flex-none text-xs text-gray-600">
        เลข CODE ต่ำสุด (ไม่บังคับ)
        <input
          type="number"
          name="codeRangeMin"
          className="mt-1 block w-24 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
        />
      </label>
      <label className="flex-none text-xs text-gray-600">
        เลข CODE สูงสุด (ไม่บังคับ)
        <input
          type="number"
          name="codeRangeMax"
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
          {isPending ? "กำลังบันทึก..." : "สร้างงาน"}
        </button>
      </div>
      {state && "error" in state && <p className="w-full text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
