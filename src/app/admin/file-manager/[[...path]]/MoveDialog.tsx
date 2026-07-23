"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { listFolder, moveEntry } from "@/lib/actions/fileManager";
import { FM_ROOT } from "@/lib/fileManager/pathScope";
import type { FmEntry } from "@/lib/actions/fileManager";

/** Simple folder-picker: browse folders (reusing the same listFolder action the main view uses),
 * pick a destination, confirm. Starts at the drive root regardless of where the entry being moved
 * currently lives. */
export function MoveDialog({
  path,
  entryName,
  onClose,
}: {
  path: string;
  entryName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [browsePath, setBrowsePath] = useState(FM_ROOT);
  const [folders, setFolders] = useState<FmEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const entries = await listFolder(browsePath);
        if (!cancelled) setFolders(entries.filter((e) => e.isDir));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "โหลดรายการโฟลเดอร์ไม่สำเร็จ");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [browsePath]);

  const segments = browsePath.split("/").slice(1); // drop the "filemanager" root segment for display

  async function handleMoveHere() {
    if (browsePath === path) return; // can't move into itself
    setMoving(true);
    setError(null);
    try {
      await moveEntry(path, browsePath);
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ย้ายไม่สำเร็จ");
    } finally {
      setMoving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[80vh] w-full max-w-md flex-col rounded-lg bg-white p-5 shadow-xl">
        <h3 className="mb-1 text-sm font-semibold text-gray-900">ย้าย &quot;{entryName}&quot; ไปที่...</h3>
        <p className="mb-3 text-xs text-gray-500">
          ตำแหน่งปัจจุบัน: {segments.length === 0 ? "หน้าแรก" : segments.join(" / ")}
        </p>

        <div className="mb-2 flex flex-wrap items-center gap-1 text-xs text-indigo-600">
          <button type="button" onClick={() => setBrowsePath(FM_ROOT)} className="hover:underline">
            หน้าแรก
          </button>
          {segments.map((seg, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="text-gray-300">/</span>
              <button
                type="button"
                onClick={() => setBrowsePath(`${FM_ROOT}/${segments.slice(0, i + 1).join("/")}`)}
                className="hover:underline"
              >
                {seg}
              </button>
            </span>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto rounded-md border border-gray-200">
          {loading ? (
            <p className="p-3 text-xs text-gray-400">กำลังโหลด...</p>
          ) : folders.length === 0 ? (
            <p className="p-3 text-xs text-gray-400">ไม่มีโฟลเดอร์ย่อย</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {folders.map((f) => (
                <li key={f.name}>
                  <button
                    type="button"
                    onClick={() => setBrowsePath(`${browsePath}/${f.name}`)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50"
                  >
                    📁 {f.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={moving || browsePath === path}
            onClick={() => void handleMoveHere()}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {moving ? "กำลังย้าย..." : "ย้ายมาที่นี่"}
          </button>
        </div>
      </div>
    </div>
  );
}
