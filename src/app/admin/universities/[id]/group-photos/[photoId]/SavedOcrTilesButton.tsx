"use client";

import { useState, useTransition } from "react";
import { listOcrTiles, deleteOcrTiles } from "@/lib/actions/ocrTileDebug";
import { BulkOcrDebugModal } from "./BulkOcrDebugModal";
import type { TileDebugInfo } from "./useBulkCardOcr";

/**
 * Views/deletes the OCR tile records persisted by ocrCardGrid (desktop "อ่านป้ายอัตโนมัติ") and the
 * mobile quick-tag auto-tag cron job — see GroupPhotoOcrTile's schema doc comment for why these
 * exist (surviving a page reload/tab close, unlike the live-run-only BulkOcrDebugModal usage
 * elsewhere on this page). Reuses that same modal to render them, since the shape matches exactly.
 */
export function SavedOcrTilesButton({
  universityId,
  groupPhotoId,
  initialCount,
}: {
  universityId: string;
  groupPhotoId: string;
  initialCount: number;
}) {
  const [count, setCount] = useState(initialCount);
  const [tiles, setTiles] = useState<TileDebugInfo[] | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();

  function openSaved() {
    startTransition(async () => {
      const rows = await listOcrTiles(universityId, groupPhotoId);
      setTiles(
        rows.map((r) => ({
          tileIndex: r.tileIndex,
          left: r.left,
          top: r.top,
          width: r.width,
          height: r.height,
          uploadWidth: r.uploadWidth,
          uploadHeight: r.uploadHeight,
          imageUrl: r.imageUrl,
          hits: r.hits,
          failed: r.failed,
        })),
      );
    });
  }

  function handleDelete() {
    if (!window.confirm(`ลบข้อมูล OCR ที่บันทึกไว้ทั้งหมด (${count} tile) ถาวร ต้องการดำเนินการต่อหรือไม่?`)) return;
    startDeleteTransition(async () => {
      const result = await deleteOcrTiles(universityId, groupPhotoId);
      setCount(0);
      setTiles(null);
      window.alert(`ลบข้อมูล OCR ที่บันทึกไว้แล้ว ${result.deleted} tile`);
    });
  }

  if (count === 0 && !tiles) return null;

  return (
    <>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={openSaved}
          disabled={isPending || count === 0}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          title="ดูภาพ tile + ตำแหน่งที่ OCR อ่านได้ที่บันทึกไว้ (จากทั้งการกดในหน้านี้และจากอัปรูปด่วน)"
        >
          {isPending ? "กำลังโหลด..." : `ดูภาพ OCR ที่บันทึกไว้ (${count})`}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isDeleting || count === 0}
          className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          {isDeleting ? "กำลังลบ..." : "ลบข้อมูล OCR ที่บันทึกไว้"}
        </button>
      </div>
      {tiles && <BulkOcrDebugModal tiles={tiles} onClose={() => setTiles(null)} />}
    </>
  );
}
