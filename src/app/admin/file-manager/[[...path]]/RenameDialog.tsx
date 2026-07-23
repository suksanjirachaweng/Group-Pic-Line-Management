"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { renameEntry } from "@/lib/actions/fileManager";
import type { FmEntry } from "@/lib/actions/fileManager";

export function RenameDialog({
  path,
  entry,
  onClose,
}: {
  path: string;
  entry: FmEntry;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(entry.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleRename() {
    if (!name.trim() || name.trim() === entry.name) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await renameEntry(path, name.trim());
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เปลี่ยนชื่อไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
        <h3 className="mb-3 text-sm font-semibold text-gray-900">เปลี่ยนชื่อ &quot;{entry.name}&quot;</h3>
        <input
          type="text"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void handleRename()}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleRename()}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </div>
      </div>
    </div>
  );
}
