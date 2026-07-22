"use client";

import { useState } from "react";
import { getGroupPhotoImageHistory, updateGroupPhotoImage, type ImageHistoryEntry } from "@/lib/actions/groupPhotos";

export function ImageHistoryButton({ universityId, groupPhotoId }: { universityId: string; groupPhotoId: string }) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<ImageHistoryEntry[] | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  async function openHistory() {
    setOpen(true);
    setHistory(null);
    const rows = await getGroupPhotoImageHistory(universityId, groupPhotoId);
    setHistory(rows);
  }

  async function restore(entry: ImageHistoryEntry) {
    if (
      !window.confirm(
        'กู้คืนรูปเวอร์ชันนี้? แท็กที่มีอยู่จะยังอยู่เหมือนเดิม แต่ตำแหน่งอาจเพี้ยนถ้ารูปนี้ไม่ตรงกับรูปปัจจุบัน (ปรับได้ทีหลังด้วยปุ่ม "ปรับตำแหน่งทั้งหมด") — รูปปัจจุบันจะถูกเก็บเข้าประวัติแทน กู้คืนกลับได้เสมอ',
      )
    ) {
      return;
    }
    setRestoringId(entry.id);
    try {
      await updateGroupPhotoImage(universityId, groupPhotoId, {
        imageUrl: entry.imageUrl,
        imageWidth: entry.imageWidth,
        imageHeight: entry.imageHeight,
      });
      // Same full-reload fix as UpdatePhotoImageButton — router.refresh() alone doesn't get the
      // already-mounted canvas to actually redraw the new image.
      window.location.reload();
    } catch (err) {
      window.alert(`กู้คืนไม่สำเร็จ: ${err instanceof Error ? err.message : "unknown error"}`);
      setRestoringId(null);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openHistory}
        className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
      >
        ประวัติรูปภาพ
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">
                ประวัติรูปภาพ{history ? ` (${history.length})` : ""}
              </h2>
              <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
                ✕
              </button>
            </div>

            {history === null && <p className="text-xs text-gray-400">กำลังโหลด...</p>}
            {history?.length === 0 && (
              <p className="text-xs text-gray-400">ยังไม่มีเวอร์ชันเก่า — รูปนี้ยังไม่เคยถูกแทนที่</p>
            )}
            <div className="space-y-2">
              {history?.map((h) => (
                <div key={h.id} className="flex items-center gap-3 rounded-md border border-gray-200 p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={h.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded object-cover" />
                  <div className="min-w-0 flex-1 text-xs text-gray-600">
                    <p>{new Date(h.createdAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}</p>
                    <p className="text-gray-400">
                      {h.imageWidth}×{h.imageHeight}px
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={restoringId === h.id}
                    onClick={() => restore(h)}
                    className="shrink-0 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-50"
                  >
                    {restoringId === h.id ? "กำลังกู้คืน..." : "กู้คืนเวอร์ชันนี้"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
