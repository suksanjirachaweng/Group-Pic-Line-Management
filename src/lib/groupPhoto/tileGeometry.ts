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
// Floor for the adaptive tile size below — keeps tile count bounded even for extreme panoramas
// (never shrinks tiles smaller than this just because the photo is short), and keeps card digits
// above the same accuracy cliff referenced above (89.2% at 800px).
const MIN_TILE_SIZE = 1000;
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
 * Tile size adapts to the photo's own resolution instead of always using the fixed TILE_SIZE
 * ceiling — real incident, 2026-07-19: a photo manually shrunk to 4091×784 before upload (vs.
 * ~2400-4900px tall for every other photo from the same event) got tiled at the fixed 2560px
 * width while its 784px height never got tiled at all (784 < 2560), producing badly non-square
 * 2560×784 tiles. Downsampling those by the long edge (see computeOcrUploadScale) crushed the
 * short edge to 480px — well past the accuracy cliff noted above — before the model ever saw it.
 *
 * Flooring the tile size at the photo's own shorter dimension (never below MIN_TILE_SIZE, never
 * above TILE_SIZE) keeps both axes tiled at the SAME size, so tiles stay roughly square — the
 * short edge is never stuck at a smaller, untiled, native value while the long edge gets tiled at
 * a much bigger fixed size. A large photo (both dimensions ≥ TILE_SIZE) behaves identically to
 * before: shortSide ≥ TILE_SIZE, so this just returns TILE_SIZE, unchanged.
 */
export function computeEffectiveTileSize(width: number, height: number): number {
  const shortSide = Math.min(width, height);
  return Math.min(TILE_SIZE, Math.max(shortSide, MIN_TILE_SIZE));
}

/**
 * How much to downscale a tile before sending it for OCR — same math for the client-driven
 * bulk-OCR hook and the server-side background auto-tag job. Just caps the long edge at
 * OCR_UPLOAD_SIZE (Claude resizes to that internally anyway, so uploading more only costs tokens)
 * — safe to keep this simple now that computeEffectiveTileSize above keeps tiles roughly square,
 * so capping the long edge no longer disproportionately crushes the short edge the way it did
 * against a fixed 2560px tile size. Never upscales past the tile's own native resolution
 * (Math.min(1, …)) — a genuinely low-resolution source photo still can't be rescued by resizing.
 */
export function computeOcrUploadScale(tile: { width: number; height: number }): number {
  return Math.min(1, OCR_UPLOAD_SIZE / Math.max(tile.width, tile.height));
}

/** Full tile list for a photo of the given dimensions — same math for the client-driven bulk-OCR
 * hook and the server-side background auto-tag job, so both tile a photo identically. */
export function computeTiles(width: number, height: number): TileRect[] {
  const tileSize = computeEffectiveTileSize(width, height);
  const xStarts = tileStarts(width, tileSize, TILE_OVERLAP);
  const yStarts = tileStarts(height, tileSize, TILE_OVERLAP);
  const tiles: TileRect[] = [];
  for (const top of yStarts) {
    for (const left of xStarts) {
      tiles.push({
        left,
        top,
        width: Math.min(tileSize, width - left),
        height: Math.min(tileSize, height - top),
      });
    }
  }
  return tiles;
}
