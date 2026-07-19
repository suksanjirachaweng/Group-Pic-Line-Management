// Tile size + model verified together empirically against a real dense sample photo (93 people,
// ground-truth checked): claude-sonnet-5 with 2560px tiles (just under its ~2576px native-detail
// ceiling) reads MORE reliably than the previous claude-haiku-4-5 + 600px config (100% vs 97.8%
// recall, clean left-right ordering vs occasional neighbor mix-ups) while also being cheaper and
// faster overall — fewer, bigger tiles means far fewer API calls, which outweighs Sonnet's higher
// per-token cost. 150px overlap is intentionally smaller (both absolutely and relatively) than the
// old 200px, since fewer/bigger tiles need less redundancy to avoid edge cutoffs.
export const TILE_SIZE = 2560;
export const TILE_OVERLAP = 150;
// Claude's vision input gets resized internally to a ~1568px long edge regardless of the upload
// size — verified that downsampling each tile to 1568px before sending is a free win (identical
// 100% recall, same unique codes found) versus uploading the full 2560px tile, since the model
// never actually saw the extra native detail anyway, just paid more input tokens for it. Below
// 1568px real accuracy starts dropping (96.8% at 1200px, 89.2% at 800px in the same test).
export const OCR_UPLOAD_SIZE = 1568;
// Below this short-edge length, printed card digits get too small to read reliably regardless of
// the long edge — same accuracy cliff referenced above (89.2% at 800px). A tile only gets this
// short unless the SOURCE photo itself is unusually short relative to TILE_SIZE (e.g. a panoramic
// photo with few rows, or one uploaded at a much lower resolution than normal — real incident:
// 2026-07-19, a photo manually shrunk to 4091×784 before upload, vs. ~2400-4900px tall for every
// other photo from the same event, tiled down to a crushed 1568×480 and came back 67% low-
// confidence). computeOcrUploadScale() below floors the short edge instead of letting the
// long-edge cap crush it.
const MIN_OCR_SHORT_EDGE = 1000;
// Bounds how many tile requests are in flight at once — used identically by the client-driven
// bulk-OCR hook and the background auto-tag cron job's own worker pool.
export const CONCURRENCY = 8;

export type TileRect = { left: number; top: number; width: number; height: number };

// Steps forward by (tile - overlap) each time, but SNAPS the final tile flush against the far
// edge instead of letting it fall wherever the fixed step lands — otherwise, whenever `size` isn't
// an exact multiple of the step, the last tile gets clipped to whatever remainder is left (observed
// as low as ~28% of a normal tile's width/height on real photo dimensions), which is a badly
// squashed, unusually-shaped crop that measurably degrades Claude's position-within-tile estimate
// (reported as systematic downward drift, worst for whichever rows land in that undersized tile).
// The snap means the last tile overlaps its neighbor by more than the nominal `overlap`, which is
// harmless — de-duplication already assumes multiple tiles will often see the same card.
export function tileStarts(size: number, tile: number, overlap: number): number[] {
  if (size <= tile) return [0];
  const starts: number[] = [];
  let s = 0;
  while (true) {
    starts.push(s);
    if (s + tile >= size) break;
    const next = s + tile - overlap;
    s = next + tile > size ? size - tile : next;
  }
  return starts;
}

/**
 * How much to downscale a tile before sending it for OCR — same math for the client-driven
 * bulk-OCR hook and the server-side background auto-tag job. Normally just caps the long edge at
 * OCR_UPLOAD_SIZE (Claude resizes to that internally anyway, so uploading more only costs tokens).
 * But a tile whose short edge is already small (a wide, short crop from a short source photo)
 * would get crushed even further by a pure long-edge cap — floor the short edge at
 * MIN_OCR_SHORT_EDGE instead, even if that means the long edge ends up bigger than
 * OCR_UPLOAD_SIZE. Never upscales past the tile's own native resolution (Math.min(1, …) both
 * places) — a genuinely low-resolution source photo still can't be rescued this way, only the
 * unnecessary extra loss from resizing-by-the-wrong-edge is.
 */
export function computeOcrUploadScale(tile: { width: number; height: number }): number {
  const longEdge = Math.max(tile.width, tile.height);
  const shortEdge = Math.min(tile.width, tile.height);
  const scale = Math.min(1, OCR_UPLOAD_SIZE / longEdge);
  if (shortEdge * scale < MIN_OCR_SHORT_EDGE) {
    return Math.min(1, MIN_OCR_SHORT_EDGE / shortEdge);
  }
  return scale;
}

/** Full tile list for a photo of the given dimensions — same math for the client-driven bulk-OCR
 * hook and the server-side background auto-tag job, so both tile a photo identically. */
export function computeTiles(width: number, height: number): TileRect[] {
  const xStarts = tileStarts(width, TILE_SIZE, TILE_OVERLAP);
  const yStarts = tileStarts(height, TILE_SIZE, TILE_OVERLAP);
  const tiles: TileRect[] = [];
  for (const top of yStarts) {
    for (const left of xStarts) {
      tiles.push({
        left,
        top,
        width: Math.min(TILE_SIZE, width - left),
        height: Math.min(TILE_SIZE, height - top),
      });
    }
  }
  return tiles;
}
