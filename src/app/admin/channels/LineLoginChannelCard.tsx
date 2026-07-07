"use client";

import { useActionState, useEffect } from "react";
import type { LineLoginChannelActionState } from "@/lib/actions/lineLoginChannel";
import { ChannelActionButton } from "./ChannelActionButton";

export function LineLoginChannelCard({
  currentChannelId,
  statusText,
  saveAction,
  issueTokenAction,
}: {
  currentChannelId: string;
  statusText: string;
  saveAction: (prevState: LineLoginChannelActionState, formData: FormData) => Promise<LineLoginChannelActionState>;
  issueTokenAction: (prevState: LineLoginChannelActionState) => Promise<LineLoginChannelActionState>;
}) {
  const [state, formAction, isPending] = useActionState(saveAction, null);

  useEffect(() => {
    if (!state) return;
    window.alert(state.success ? state.message : `ไม่สำเร็จ: ${state.error}`);
  }, [state]);

  return (
    <div className="mb-6 rounded-md border border-indigo-200 bg-indigo-50/40 p-4">
      <h2 className="mb-1 text-sm font-semibold text-gray-900">LINE Login Channel (ใช้ร่วมกันสำหรับ LIFF)</h2>
      <p className="mb-3 text-xs text-gray-500">
        LINE ไม่อนุญาตให้สร้าง LIFF app บน Messaging API channel โดยตรง ต้องใช้ LINE Login channel แยกต่างหาก —
        โปรเจกต์นี้ใช้ LINE Login channel ตัวเดียวร่วมกันสำหรับ LIFF ของทุกมหาวิทยาลัย ตั้งค่าที่นี่ครั้งเดียว
        พอ ไม่ต้องตั้งแยกทีละแชนแนล
      </p>
      <p className="mb-3 text-xs text-gray-600">{statusText}</p>
      <form action={formAction} className="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700">LINE Login Channel ID</label>
          <input
            name="channelId"
            defaultValue={currentChannelId}
            required
            className="mt-1 w-56 rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700">LINE Login Channel Secret</label>
          <input
            name="channelSecret"
            placeholder="Leave blank to keep the current value"
            className="mt-1 w-64 rounded-md border border-gray-300 px-3 py-2 font-mono text-xs"
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {isPending ? "กำลังบันทึก..." : "Save"}
        </button>
      </form>
      <ChannelActionButton action={issueTokenAction} idleLabel="ออก token" pendingLabel="กำลังออก..." />
    </div>
  );
}
