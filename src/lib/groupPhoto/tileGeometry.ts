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
