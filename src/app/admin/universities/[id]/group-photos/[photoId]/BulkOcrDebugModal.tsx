"use client";

import type { TileDebugInfo } from "./useBulkCardOcr";

/**
 * Shows exactly what "อ่านป้ายอัตโนมัติ" sent to Claude and got back, one tile at a time — the
 * actual (downsampled) image uploaded, plus every hit's raw position drawn directly on it. Purely
 * a diagnostic view (nothing here saves anything) for tracking down a specific misread or
 * mispositioned card back to the tile it came from, since the final merged result on the full
 * photo alone doesn't show which tile produced it or what the model actually saw.
 */
export function BulkOcrDebugModal({
  tiles,
  onClose,
}: {
  tiles: TileDebugInfo[];
  onClose: () => void;
}) {
  const sorted = [...tiles].sort((a, b) => a.tileIndex - b.tileIndex);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <h2 className="text-lg font-semibold text-gray-900">
            ตรวจสอบผล OCR แต่ละ tile ({sorted.length} tile)
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            ปิด
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          {sorted.map((tile) => (
            <div key={tile.tileIndex} className="rounded-md border border-gray-200 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <span className="font-medium text-gray-700">Tile #{tile.tileIndex + 1}</span>
                <span>
                  ตำแหน่งในภาพเต็ม: ({Math.round(tile.left)}, {Math.round(tile.top)}) ขนาด{" "}
                  {Math.round(tile.width)}×{Math.round(tile.height)}px
                </span>
                {tile.failed ? (
                  <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700">เรียก OCR ไม่สำเร็จ</span>
                ) : (
                  <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
                    อ่านได้ {tile.hits.length} ป้าย
                  </span>
                )}
              </div>

              {tile.failed ? (
                <div className="flex h-32 items-center justify-center rounded bg-gray-50 text-sm text-gray-400">
                  ไม่มีภาพ (tile นี้ล้มเหลว)
                </div>
              ) : (
                <div className="relative inline-block max-w-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={tile.imageUrl}
                    alt={`tile ${tile.tileIndex + 1}`}
                    className="max-h-[420px] max-w-full rounded border border-gray-100"
                  />
                  {tile.hits.map((hit, i) => (
                    <div
                      key={i}
                      className="absolute -translate-x-1/2 -translate-y-1/2"
                      style={{ left: `${hit.x / 10}%`, top: `${hit.y / 10}%` }}
                    >
                      <div className="h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-lime-400 bg-lime-400/30" />
                      <span className="absolute left-1/2 top-full -translate-x-1/2 whitespace-nowrap rounded bg-lime-600 px-1 py-0.5 text-[10px] font-medium text-white">
                        {hit.code}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
