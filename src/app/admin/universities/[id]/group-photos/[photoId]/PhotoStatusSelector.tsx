"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateGroupPhotoStatus } from "@/lib/actions/groupPhotos";
import type { GroupPhotoStatus } from "@/generated/prisma/enums";

const OPTIONS: { value: GroupPhotoStatus; label: string; activeClass: string }[] = [
  { value: "NOT_STARTED", label: "เริ่มดำเนินการ", activeClass: "bg-gray-600 text-white" },
  { value: "NEEDS_EDIT", label: "เปิดให้แก้ไข", activeClass: "bg-amber-500 text-white" },
  { value: "DONE", label: "แก้ไขเสร็จแล้ว", activeClass: "bg-green-600 text-white" },
];

export function PhotoStatusSelector({
  universityId,
  groupPhotoId,
  status,
}: {
  universityId: string;
  groupPhotoId: string;
  status: GroupPhotoStatus;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="flex items-center gap-1 rounded-md border border-gray-300 p-0.5 text-xs">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={isPending}
          title={
            o.value === "DONE"
              ? "ทำเครื่องหมายว่าตรวจสอบเสร็จแล้ว — จะหยุดอัปเดตข้อมูลอัตโนมัติจากรายชื่อ/LINE ให้"
              : "ยังเปิดรับข้อมูลอัปเดตอัตโนมัติจากรายชื่อ/LINE อยู่"
          }
          onClick={() => {
            if (o.value === status) return;
            startTransition(async () => {
              await updateGroupPhotoStatus(universityId, groupPhotoId, o.value);
              router.refresh();
            });
          }}
          className={`rounded px-2.5 py-1 font-medium transition disabled:opacity-50 ${
            status === o.value ? o.activeClass : "text-gray-500 hover:bg-gray-100"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
