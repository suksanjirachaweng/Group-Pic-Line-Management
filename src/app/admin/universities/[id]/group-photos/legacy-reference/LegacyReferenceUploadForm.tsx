"use client";

import { useActionState } from "react";
import { importLegacyReferences, type LegacyImportState } from "@/lib/actions/groupPhotoLegacyReferences";

export function LegacyReferenceUploadForm({ universityId }: { universityId: string }) {
  const action = importLegacyReferences.bind(null, universityId);
  const [state, formAction, isPending] = useActionState<LegacyImportState, FormData>(action, null);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="file" name="file" accept=".xlsx,.xls" required className="text-sm" />
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {isPending ? "กำลังนำเข้า..." : "อัปโหลด (แทนที่ข้อมูลเดิม)"}
      </button>
      {state && "error" in state && <p className="text-xs text-red-600">{state.error}</p>}
      {state && "success" in state && <p className="text-xs text-green-600">นำเข้าแล้ว {state.count} รายการ</p>}
    </form>
  );
}
