"use client";

import { useActionState, useEffect } from "react";
import type { ChannelActionState } from "@/lib/actions/channels";

export function DeleteChannelButton({
  action,
  channelName,
}: {
  action: (prevState: ChannelActionState) => Promise<ChannelActionState>;
  channelName: string;
}) {
  const [state, formAction, isPending] = useActionState(action, null);

  useEffect(() => {
    if (state && !state.success) window.alert(`ลบไม่สำเร็จ: ${state.error}`);
  }, [state]);

  return (
    <div className="rounded-md border border-red-200 bg-white p-4">
      <h2 className="mb-1 text-sm font-semibold text-red-700">Danger zone</h2>
      <p className="mb-3 text-xs text-gray-500">
        ลบแชนแนลนี้ถาวร ใช้ได้เฉพาะแชนแนลที่ยังไม่มีผู้ลงทะเบียน/ประวัติข้อความผูกอยู่ (เช่น สร้างผิดพลาด) — ถ้าแชนแนลนี้เคยใช้งานจริงแล้ว ให้ใช้ปุ่ม
        Deactivate ด้านบนแทน
      </p>
      <form
        action={formAction}
        onSubmit={(e) => {
          if (!window.confirm(`ยืนยันลบแชนแนล "${channelName}" ถาวร? การกระทำนี้ย้อนกลับไม่ได้`)) {
            e.preventDefault();
          }
        }}
      >
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          {isPending ? "กำลังลบ..." : "Delete channel"}
        </button>
      </form>
    </div>
  );
}
