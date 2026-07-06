"use client";

import { useActionState, useEffect } from "react";
import type { PublishRichMenuState } from "@/lib/actions/channels";

export function PublishRichMenuButton({
  action,
  hasExisting,
}: {
  action: (prevState: PublishRichMenuState) => Promise<PublishRichMenuState>;
  hasExisting: boolean;
}) {
  const [state, formAction, isPending] = useActionState(action, null);

  useEffect(() => {
    if (!state) return;
    if (state.success) {
      window.alert(`เผยแพร่ rich menu เรียบร้อยแล้ว (ID: ${state.richMenuId})`);
    } else {
      window.alert(`เผยแพร่ rich menu ไม่สำเร็จ: ${state.error}`);
    }
  }, [state]);

  return (
    <form action={formAction}>
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
