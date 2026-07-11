"use client";

import { useState, useTransition } from "react";
import { updateGroupPhotoTitle } from "@/lib/actions/groupPhotos";

export function PhotoTitleEditor({
  universityId,
  groupPhotoId,
  name,
  title,
}: {
  universityId: string;
  groupPhotoId: string;
  name: string;
  title: string | null;
}) {
  const [currentTitle, setCurrentTitle] = useState(title);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title ?? "");
  const [isPending, startTransition] = useTransition();

  const displayTitle = currentTitle?.trim() || name;

  function save() {
    const next = value.trim() || null;
    startTransition(async () => {
      await updateGroupPhotoTitle(universityId, groupPhotoId, next);
      setCurrentTitle(next);
      setEditing(false);
    });
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-1.5">
        <h1 className="text-sm font-semibold text-gray-900">{displayTitle}</h1>
        {currentTitle?.trim() && currentTitle.trim() !== name && (
          <span className="text-xs text-gray-400">(คณะ: {name})</span>
        )}
        <button
          type="button"
          onClick={() => {
            setValue(currentTitle ?? "");
            setEditing(true);
          }}
          title="แก้ไขหัวข้อรูป"
          className="text-gray-400 hover:text-gray-600"
        >
          ✎
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={name}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            setEditing(false);
          }
        }}
        className="rounded-md border border-gray-300 px-2 py-1 text-sm"
      />
      <button
        type="button"
        disabled={isPending}
        onClick={save}
        className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {isPending ? "..." : "บันทึก"}
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
      >
        ยกเลิก
      </button>
    </div>
  );
}
