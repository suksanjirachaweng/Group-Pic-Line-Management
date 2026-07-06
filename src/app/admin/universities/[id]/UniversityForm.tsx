"use client";

import { useActionState, useEffect } from "react";
import type { UpdateUniversityState } from "@/lib/actions/universities";

export function UniversityForm({
  action,
  children,
  className = "space-y-4 rounded-md border border-gray-200 bg-white p-6",
}: {
  action: (prevState: UpdateUniversityState, formData: FormData) => Promise<UpdateUniversityState>;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, null);

  useEffect(() => {
    if (state?.success) {
      window.alert("บันทึกข้อมูลเรียบร้อยแล้ว");
    }
  }, [state]);

  return (
    <form action={formAction} className={className}>
      {children}
    </form>
  );
}
