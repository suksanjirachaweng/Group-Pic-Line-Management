"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteGroupPhoto } from "@/lib/actions/groupPhotos";

export function DeleteGroupPhotoButton({
  universityId,
  groupPhotoId,
  photoName,
}: {
  universityId: string;
  groupPhotoId: string;
  photoName: string;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (!window.confirm(`ลบรูป "${photoName}" ถาวร? ข้อมูลแท็กทั้งหมดในรูปนี้จะหายไปด้วย`)) return;
        startTransition(async () => {
          await deleteGroupPhoto(universityId, groupPhotoId);
          router.refresh();
        });
      }}
      className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-50"
    >
      ลบ
    </button>
  );
}
