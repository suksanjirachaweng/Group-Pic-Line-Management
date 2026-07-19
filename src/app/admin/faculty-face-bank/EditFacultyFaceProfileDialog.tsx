"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import {
  renameFacultyFaceProfile,
  deleteFacultyFaceProfile,
  type FaceBankProfileActionState,
} from "@/lib/actions/facultyFaceBank";

export function EditFacultyFaceProfileDialog({
  profile,
  onClose,
}: {
  profile: { id: string; name: string; sourceCropUrl: string };
  onClose: () => void;
}) {
  const router = useRouter();
  const renameAction = renameFacultyFaceProfile.bind(null, profile.id);
  const [state, formAction, isPending] = useActionState<FaceBankProfileActionState, FormData>(
    async (prev, formData) => {
      const result = await renameAction(prev, formData);
      if (result && "success" in result) {
        router.refresh();
        onClose();
      }
      return result;
    },
    null,
  );

  async function handleDelete() {
    if (!window.confirm(`ลบ "${profile.name}" ออกจากคลังใบหน้าอาจารย์? การลบนี้ย้อนกลับไม่ได้`)) return;
    const result = await deleteFacultyFaceProfile(profile.id);
    if (result && "error" in result) {
      window.alert(result.error);
      return;
    }
    router.refresh();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={profile.sourceCropUrl} alt="" className="h-16 w-16 shrink-0 rounded-md object-cover" />
          <h3 className="text-sm font-semibold text-gray-900">แก้ไขข้อมูล</h3>
        </div>
        <form action={formAction}>
          <label className="block text-xs font-medium text-gray-700">
            ชื่อ-นามสกุล
            <input
              name="name"
              defaultValue={profile.name}
              autoFocus
              className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
            />
          </label>
          {state && "error" in state && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleDelete}
              className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              ลบ
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {isPending ? "กำลังบันทึก..." : "บันทึก"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
