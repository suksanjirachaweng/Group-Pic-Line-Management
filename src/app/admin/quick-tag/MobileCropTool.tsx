"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { extractRectCrop } from "@/lib/groupPhoto/coordinateMapping";
import { TILE_SIZE } from "@/lib/groupPhoto/tileGeometry";

const DISPLAY_MAX_WIDTH = 1400;

/**
 * A focused, mobile-first crop tool — not the full desktop tagging canvas (which also handles
 * pan/zoom/tagging/OCR). Drag-to-select uses pointer events (unified touch+mouse), unlike the
 * desktop crop tool's mouse-only handlers, so a finger-drag works the same as a mouse-drag.
 */
export function MobileCropTool({
  bitmap,
  onConfirm,
  onCancel,
}: {
  bitmap: ImageBitmap;
  onConfirm: (blob: Blob, width: number, height: number) => void;
  onCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Canvas-relative pixel coordinates, computed directly inside pointer event handlers — never
  // read from a ref during render (same convention as the desktop crop tool's own cropRect).
  const [rect, setRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [saving, setSaving] = useState(false);

  const displayW = Math.min(DISPLAY_MAX_WIDTH, bitmap.width);
  const displayH = Math.round(bitmap.height * (displayW / bitmap.width));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = displayW;
    canvas.height = displayH;
    const ctx = canvas.getContext("2d");
    ctx?.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, displayW, displayH);
  }, [bitmap, displayW, displayH]);

  function pointFromEvent(e: ReactPointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pointFromEvent(e);
    setRect({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!rect) return;
    const p = pointFromEvent(e);
    setRect((prev) => (prev ? { ...prev, x2: p.x, y2: p.y } : prev));
  }

  async function handleConfirm() {
    const canvas = canvasRef.current;
    if (!rect || !canvas) return;
    const r = canvas.getBoundingClientRect();
    const toFull = (x: number, y: number) => ({
      x: (x / r.width) * bitmap.width,
      y: (y / r.height) * bitmap.height,
    });
    const p1 = toFull(rect.x1, rect.y1);
    const p2 = toFull(rect.x2, rect.y2);
    const sx = Math.max(0, Math.min(p1.x, p2.x));
    const sy = Math.max(0, Math.min(p1.y, p2.y));
    const sw = Math.min(bitmap.width - sx, Math.abs(p2.x - p1.x));
    const sh = Math.min(bitmap.height - sy, Math.abs(p2.y - p1.y));
    if (sw < 20 || sh < 20) {
      window.alert("พื้นที่ที่เลือกเล็กเกินไป กรุณาลากเลือกใหม่");
      return;
    }
    setSaving(true);
    try {
      // Same height>TILE_SIZE downscale as the desktop crop tool — keeps the later bulk-OCR tiling
      // to as few tiles as possible instead of extra rows purely from height.
      const scale = sh > TILE_SIZE ? TILE_SIZE / sh : 1;
      const destW = sw * scale;
      const destH = sh * scale;
      const blob = await extractRectCrop(bitmap, sx, sy, sw, sh, destW, destH);
      onConfirm(blob, Math.round(destW), Math.round(destH));
    } finally {
      setSaving(false);
    }
  }

  const overlayStyle = rect
    ? {
        left: Math.min(rect.x1, rect.x2),
        top: Math.min(rect.y1, rect.y2),
        width: Math.abs(rect.x2 - rect.x1),
        height: Math.abs(rect.y2 - rect.y1),
      }
    : null;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 overflow-y-auto p-4">
      <p className="text-center text-sm text-gray-600">ลากบนรูปเพื่อเลือกพื้นที่ที่ต้องการครอบตัด</p>
      <div className="relative inline-block max-w-full">
        <canvas
          ref={canvasRef}
          className="max-w-full touch-none rounded-lg border border-gray-300"
          style={{ width: "100%", height: "auto", display: "block" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
        />
        {overlayStyle && (
          <div
            className="pointer-events-none absolute border-2 border-dashed border-indigo-500 bg-indigo-500/20"
            style={overlayStyle}
          />
        )}
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700"
        >
          ยกเลิก
        </button>
        <button
          type="button"
          onClick={() => void handleConfirm()}
          disabled={!rect || saving}
          className="rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? "กำลังครอบตัด..." : "ยืนยันครอบตัด"}
        </button>
      </div>
    </div>
  );
}
