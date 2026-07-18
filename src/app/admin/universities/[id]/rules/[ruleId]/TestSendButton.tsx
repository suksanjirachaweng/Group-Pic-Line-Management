"use client";

import { useActionState, useState } from "react";
import { testSendRule, type TestSendState } from "@/lib/actions/rules";

type Registrant = { id: string; displayName: string | null; lineUserId: string };

export function TestSendButton({
  universityId,
  ruleId,
  registrants,
}: {
  universityId: string;
  ruleId: string;
  registrants: Registrant[];
}) {
  const [open, setOpen] = useState(false);
  const action = testSendRule.bind(null, universityId, ruleId);
  const [state, formAction, isPending] = useActionState<TestSendState, FormData>(action, null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        ทดสอบส่งหาตัวเอง
      </button>
    );
  }

  return (
    <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-4">
      <p className="mb-2 text-sm font-medium text-gray-700">ทดสอบส่งหาตัวเอง</p>
      <p className="mb-3 text-xs text-gray-500">
        ส่งข้อความจาก template ปัจจุบันจริงผ่าน LINE ไปหาผู้ลงทะเบียนที่เลือก (ต้องผูก LINE ไว้แล้ว) —
        ข้ามเงื่อนไขทั้งหมด ไม่นับเป็นการทำงานจริงของ rule นี้ ใช้เวลาถึงประมาณ 1 นาที เช็คผลได้ที่หน้ารายละเอียดผู้รับ
      </p>
      {registrants.length === 0 ? (
        <p className="text-sm text-gray-400">ยังไม่มีผู้ลงทะเบียนที่ผูก LINE ไว้ในมหาวิทยาลัยนี้</p>
      ) : (
        <form action={formAction} className="flex flex-wrap items-center gap-2">
          <select
            name="registrantId"
            required
            className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
          >
            {registrants.map((r) => (
              <option key={r.id} value={r.id}>
                {r.displayName ?? r.lineUserId}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {isPending ? "กำลังส่ง..." : "ส่งทดสอบ"}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-white"
          >
            ปิด
          </button>
        </form>
      )}
      {state && "success" in state && state.success && (
        <p className="mt-2 text-sm text-emerald-600">
          เข้าคิวส่งไปหา {state.displayName} แล้ว — จะถึงในประมาณ 1 นาที
        </p>
      )}
      {state && "error" in state && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
    </div>
  );
}
