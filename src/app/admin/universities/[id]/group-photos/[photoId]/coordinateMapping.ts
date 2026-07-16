/**
 * All tag coordinates are stored in full-resolution pixel space (matches the legacy tool's
 * export exactly). The canvas may be displayed at any size/zoom via CSS transform — rather than
 * tracking transform state manually, we read the canvas's actual rendered box
 * (getBoundingClientRect already reflects any CSS transform) and convert through that.
 */
export function clientPointToFullRes(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  fullWidth: number,
  fullHeight: number,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * fullWidth,
    y: ((clientY - rect.top) / rect.height) * fullHeight,
  };
}

/**
 * Fractional position (0-1) for placing a marker via absolute positioning (left/top as %) inside
 * a container that exactly overlaps the canvas — this stays correct under any zoom/pan without
 * needing to track transform state, since percentages are relative to the (already-transformed)
 * container box.
 */
export function fullResToFraction(
  x: number,
  y: number,
  fullWidth: number,
  fullHeight: number,
): { xFrac: number; yFrac: number } {
  return { xFrac: x / fullWidth, yFrac: y / fullHeight };
}

/** Crops a square region around a full-resolution point from the full-res decoded bitmap. */
export async function extractCrop(
  fullBitmap: ImageBitmap,
  centerX: number,
  centerY: number,
  size = 320,
): Promise<Blob> {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  const sx = Math.max(0, Math.min(centerX - size / 2, fullBitmap.width - size));
  const sy = Math.max(0, Math.min(centerY - size / 2, fullBitmap.height - size));
  const sw = Math.min(size, fullBitmap.width);
  const sh = Math.min(size, fullBitmap.height);
  ctx.drawImage(fullBitmap, sx, sy, sw, sh, 0, 0, size, size);
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
}

/** Euclidean distance in full-resolution pixel space, used for "nearest tag" hit-testing. */
export function pixelDistance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/**
 * Crops an arbitrary full-resolution rectangle out of the decoded bitmap, at that rectangle's own
 * native resolution by default (unlike `extractCrop`, which always outputs a fixed-size square for
 * OCR) — for replacing the whole photo with a user-selected region via the tagging canvas's crop
 * tool. An optional output size (`destW`/`destH`) downsamples during the crop instead of after —
 * used by the bulk card-OCR tiler, since Claude's vision input is internally resized to a ~1568px
 * long edge regardless of what's uploaded, so sending anything larger only costs more tokens for
 * the same effective resolution the model actually sees (verified empirically before this change).
 */
export async function extractRectCrop(
  fullBitmap: ImageBitmap,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  destW: number = sw,
  destH: number = sh,
): Promise<Blob> {
  const outW = Math.round(destW);
  const outH = Math.round(destH);
  const canvas = new OffscreenCanvas(outW, outH);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  ctx.drawImage(fullBitmap, sx, sy, sw, sh, 0, 0, outW, outH);
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
}
