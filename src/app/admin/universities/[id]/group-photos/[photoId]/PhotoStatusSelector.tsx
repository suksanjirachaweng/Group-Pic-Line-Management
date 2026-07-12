"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateGroupPhotoStatus } from "@/lib/actions/groupPhotos";
import type { GroupPhotoStatus } from "@/generated/prisma/enums";

const OPTIONS: { value: GroupPhotoStatus; label: string; title: string }[] = [
  {
    value: "NOT_STARTED",
    label: "เริ่มดำเนินการ",
    title: "ยังเปิดรับข้อมูลอัปเดตอัตโนมัติจากรายชื่อ/LINE อยู่",
  },
  {
    value: "NEEDS_EDIT",
    label: "เปิดให้แก้ไข",
    title: "ยังเปิดรับข้อมูลอัปเดตอัตโนมัติจากรายชื่อ/LINE อยู่",
  },
  {
    value: "DONE",
    label: "แก้ไขเสร็จแล้ว",
    title: "ทำเครื่องหมายว่าตรวจสอบเสร็จแล้ว — จะหยุดอัปเดตข้อมูลอัตโนมัติจากรายชื่อ/LINE ให้",
  },
];

const STATUS_CLASS: Record<GroupPhotoStatus, string> = {
  NOT_STARTED: "border-gray-300 bg-gray-50 text-gray-700",
  NEEDS_EDIT: "border-amber-300 bg-amber-50 text-amber-700",
  DONE: "border-green-300 bg-green-50 text-green-700",
};

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
    <select
      value={status}
      disabled={isPending}
      title={OPTIONS.find((o) => o.value === status)?.title}
      onChange={(e) => {
        const next = e.target.value as GroupPhotoStatus;
        if (next === status) return;
        startTransition(async () => {
          await updateGroupPhotoStatus(universityId, groupPhotoId, next);
          router.refresh();
        });
      }}
      className={`rounded-md border px-2.5 py-1.5 text-xs font-medium disabled:opacity-50 ${STATUS_CLASS[status]}`}
    >
      {OPTIONS.map((o) => (
        <option key={o.value} value={o.value} title={o.title}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
