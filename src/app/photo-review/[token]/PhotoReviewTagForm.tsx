"use client";

import { useActionState } from "react";
import { updateTagViaPublicLink } from "@/lib/actions/publicGroupPhoto";

export function PhotoReviewTagForm({
  token,
  tag,
}: {
  token: string;
  tag: { id: string; name: string; code: string; row: number; order: number };
}) {
  const [state, formAction, isPending] = useActionState(updateTagViaPublicLink.bind(null, token, tag.id), null);

  return (
    <form action={formAction} className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="mb-2 text-xs text-gray-500">แถว {tag.row} ลำดับ {tag.order}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          name="code"
          defaultValue={tag.code}
          placeholder="หมายเลข"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm sm:w-32"
        />
        <input
          name="name"
          defaultValue={tag.name}
          placeholder="ชื่อ-นามสกุล"
          className="w-full flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {isPending ? "กำลังบันทึก..." : "บันทึก"}
        </button>
      </div>
      {state && "error" in state && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
      {state && "success" in state && <p className="mt-2 text-sm text-green-600">บันทึกแล้ว</p>}
    </form>
  );
}
