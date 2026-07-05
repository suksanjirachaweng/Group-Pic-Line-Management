"use client";

import { useActionState, useEffect } from "react";
import type { UpdateChannelState } from "@/lib/actions/channels";

export function ChannelForm({
  action,
  children,
}: {
  action: (prevState: UpdateChannelState, formData: FormData) => Promise<UpdateChannelState>;
  children: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, null);

  useEffect(() => {
    if (state?.success) {
      window.alert("บันทึกข้อมูลเรียบร้อยแล้ว");
    }
  }, [state]);

  return (
    <form action={formAction} className="space-y-4 rounded-md border border-gray-200 bg-white p-6">
      {children}
    </form>
  );
}
