"use client";

import { useActionState, useEffect, useState } from "react";
import type { PublishRichMenuState } from "@/lib/actions/channels";

export function PublishRichMenuButton({
  action,
  hasExisting,
}: {
  action: (prevState: PublishRichMenuState, formData: FormData) => Promise<PublishRichMenuState>;
  hasExisting: boolean;
}) {
  const [state, formAction, isPending] = useActionState(action, null);
  const [variant, setVariant] = useState<"ONE_BUTTON" | "THREE_BUTTON">("ONE_BUTTON");

  useEffect(() => {
    if (!state) return;
    if (state.success) {
      window.alert(`เผยแพร่ rich menu เรียบร้อยแล้ว (ID: ${state.richMenuId})`);
    } else {
      window.alert(`เผยแพร่ rich menu ไม่สำเร็จ: ${state.error}`);
    }
  }, [state]);

  return (
    <form action={formAction} className="space-y-3">
      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-xs font-medium text-gray-700">รูปแบบเมนู</legend>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="radio"
            name="variant"
            value="ONE_BUTTON"
            checked={variant === "ONE_BUTTON"}
            onChange={() => setVariant("ONE_BUTTON")}
          />
          เมนูเดียว (ลงทะเบียน)
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="radio"
            name="variant"
            value="THREE_BUTTON"
            checked={variant === "THREE_BUTTON"}
            onChange={() => setVariant("THREE_BUTTON")}
          />
          3 ปุ่ม (ลงทะเบียน / สั่งซื้อภาพ / ตรวจสอบสถานะ) — แบบเดิม
        </label>
      </fieldset>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-[#06C755] px-3 py-2 text-sm font-medium text-white hover:bg-[#05a648] disabled:opacity-50"
      >
        {isPending ? "กำลังเผยแพร่..." : hasExisting ? "อัปเดต Rich menu" : "สร้าง Rich menu"}
      </button>
    </form>
  );
}
