"use client";

import { useActionState, useEffect } from "react";

type ActionState = { success: true; message: string } | { success: false; error: string } | null;

export function ChannelActionButton({
  action,
  idleLabel,
  pendingLabel,
}: {
  action: (prevState: ActionState) => Promise<ActionState>;
  idleLabel: string;
  pendingLabel: string;
}) {
  const [state, formAction, isPending] = useActionState(action, null);

  useEffect(() => {
    if (!state) return;
    window.alert(state.success ? state.message : `ไม่สำเร็จ: ${state.error}`);
  }, [state]);

  return (
    <form action={formAction}>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md border border-[#06C755] px-3 py-2 text-xs font-medium text-[#06C755] hover:bg-[#06C755]/10 disabled:opacity-50"
      >
        {isPending ? pendingLabel : idleLabel}
      </button>
    </form>
  );
}
