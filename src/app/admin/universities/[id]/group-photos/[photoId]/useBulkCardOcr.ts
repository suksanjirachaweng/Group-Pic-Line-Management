"use client";

import { useCallback, useState } from "react";
import { ocrCardGrid } from "@/lib/actions/bulkCardOcr";
import { extractRectCrop } from "./coordinateMapping";

export type BulkOcrCandidate = { id: string; code: string; x: number; y: number };

// One entry per tile actually sent to Claude, kept around purely so an admin can open the
// "ตรวจสอบผล OCR" debug view and see exactly what image + raw hits each tile produced — the same
// evidence a developer would otherwise only get by adding console.logs. `hits` are the raw,
// still-tile-local pixel values as returned by the model (relative to `uploadWidth`/`uploadHeight`,
// the actual image the model was shown — NOT `width`/`height`, which are this tile's full-resolution
// size before downsampling), not yet mapped to full-photo coordinates, since the debug view draws
// them directly over the (downsampled) tile image itself.
export type TileDebugInfo = {
  tileIndex: number;
  left: number;
  top: number;
  width: number;
  height: number;
  uploadWidth: number;
  uploadHeight: number;
  imageUrl: string;
  hits: { code: string; x: number; y: number }[];
  failed: boolean;
};

// Tile size + model verified together empirically against a real dense sample photo (93 people,
// ground-truth checked): claude-sonnet-5 with 2560px tiles (just under its ~2576px native-detail
// ceiling) reads MORE reliably than the previous claude-haiku-4-5 + 600px config (100% vs 97.8%
// recall, clean left-right ordering vs occasional neighbor mix-ups) while also being cheaper and
// faster overall — fewer, bigger tiles means far fewer API calls, which outweighs Sonnet's higher
// per-token cost. 150px overlap is intentionally smaller (both absolutely and relatively) than the
// old 200px, since fewer/bigger tiles need less redundancy to avoid edge cutoffs.
const TILE_SIZE = 2560;
const TILE_OVERLAP = 150;
// Claude's vision input gets resized internally to a ~1568px long edge regardless of the upload
// size — verified that downsampling each tile to 1568px before sending is a free win (identical
// 100% recall, same unique codes found) versus uploading the full 2560px tile, since the model
// never actually saw the extra native detail anyway, just paid more input tokens for it. Below
// 1568px real accuracy starts dropping (96.8% at 1200px, 89.2% at 800px in the same test).
const OCR_UPLOAD_SIZE = 1568;
// Tiles are now few (a handful for a typical wide photo) and each is a real ~1568px JPEG, not the
// old small 600x600 crop — concurrency mainly bounds how many large requests are in flight at
// once, not total wall time the way it did with hundreds of tiny tiles.
const CONCURRENCY = 8;

// Steps forward by (tile - overlap) each time, but SNAPS the final tile flush against the far
// edge instead of letting it fall wherever the fixed step lands — otherwise, whenever `size` isn't
// an exact multiple of the step, the last tile gets clipped to whatever remainder is left (observed
// as low as ~28% of a normal tile's width/height on real photo dimensions), which is a badly
// squashed, unusually-shaped crop that measurably degrades Claude's position-within-tile estimate
// (reported as systematic downward drift, worst for whichever rows land in that undersized tile).
// The snap means the last tile overlaps its neighbor by more than the nominal `overlap`, which is
// harmless — de-duplication already assumes multiple tiles will often see the same card.
function tileStarts(size: number, tile: number, overlap: number): number[] {
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

export function useBulkCardOcr() {
  const [isDetecting, setIsDetecting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  });
  const [candidates, setCandidates] = useState<BulkOcrCandidate[]>([]);
  // Surfaced so it's possible to tell, after a run, whether tiles are silently failing (e.g. API
  // rate limits) rather than the photo genuinely having fewer readable cards than expected — the
  // per-tile catch below used to only log to the console, invisible in normal use.
  const [failedTiles, setFailedTiles] = useState(0);
  const [tileDebug, setTileDebug] = useState<TileDebugInfo[]>([]);

  const detect = useCallback(async (fullBitmap: ImageBitmap, universityId: string) => {
    setIsDetecting(true);
    setCandidates([]);
    setFailedTiles(0);
    // Revoke the previous run's object URLs before dropping the references, or they leak for the
    // life of the tab (createObjectURL blobs aren't garbage-collected on their own).
    setTileDebug((prev) => {
      for (const t of prev) URL.revokeObjectURL(t.imageUrl);
      return [];
    });
    try {
      const { width, height } = fullBitmap;
      const xStarts = tileStarts(width, TILE_SIZE, TILE_OVERLAP);
      const yStarts = tileStarts(height, TILE_SIZE, TILE_OVERLAP);
      const tiles: { left: number; top: number; width: number; height: number }[] = [];
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

      setProgress({ done: 0, total: tiles.length });
      const seenCodes = new Set<string>();
      const found: BulkOcrCandidate[] = [];
      let next = 0;
      let done = 0;

      async function worker() {
        while (next < tiles.length) {
          const tileIndex = next++;
          const tile = tiles[tileIndex];
          try {
            const scale = Math.min(1, OCR_UPLOAD_SIZE / Math.max(tile.width, tile.height));
            const blob = await extractRectCrop(
              fullBitmap,
              tile.left,
              tile.top,
              tile.width,
              tile.height,
              tile.width * scale,
              tile.height * scale,
            );
            const fd = new FormData();
            fd.set("crop", blob, "tile.jpg");
            const { hits, width: uploadWidth, height: uploadHeight } = await ocrCardGrid(
              universityId,
              fd,
            );
            // Kept for the "ตรวจสอบผล OCR" debug view — the exact image sent plus the raw,
            // still-tile-local hits, so an admin can see precisely what the model was shown and
            // what it reported, independent of whatever de-dup/mapping happens below.
            setTileDebug((prev) => [
              ...prev,
              {
                tileIndex,
                left: tile.left,
                top: tile.top,
                width: tile.width,
                height: tile.height,
                uploadWidth,
                uploadHeight,
                imageUrl: URL.createObjectURL(blob),
                hits,
                failed: false,
              },
            ]);
            for (const hit of hits) {
              // First tile to read a given code wins — with 200px overlap, most cards get read
              // by 2+ neighboring tiles, so this is mainly de-duplication rather than a real
              // confidence choice between candidates.
              if (seenCodes.has(hit.code)) continue;
              seenCodes.add(hit.code);
              found.push({
                id: `bulk-ocr-${hit.code}`,
                code: hit.code,
                // hit.x/hit.y are real pixel coordinates within the uploaded (downsampled) image
                // (see bulkCardOcr.ts) — map back to this tile's own full-resolution size first,
                // then place within the full photo.
                x: tile.left + (hit.x / uploadWidth) * tile.width,
                y: tile.top + (hit.y / uploadHeight) * tile.height,
              });
            }
          } catch (err) {
            console.error("Bulk card OCR failed for a tile:", err);
            setFailedTiles((n) => n + 1);
            setTileDebug((prev) => [
              ...prev,
              {
                tileIndex,
                left: tile.left,
                top: tile.top,
                width: tile.width,
                height: tile.height,
                uploadWidth: 0,
                uploadHeight: 0,
                imageUrl: "",
                hits: [],
                failed: true,
              },
            ]);
          }
          done++;
          setProgress({ done, total: tiles.length });
          setCandidates([...found]);
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, tiles.length) }, worker),
      );
    } finally {
      setIsDetecting(false);
    }
  }, []);

  const dismiss = useCallback((id: string) => {
    setCandidates((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const reset = useCallback(() => {
    setCandidates([]);
    setProgress({ done: 0, total: 0 });
    setFailedTiles(0);
    setTileDebug((prev) => {
      for (const t of prev) URL.revokeObjectURL(t.imageUrl);
      return [];
    });
  }, []);

  return { candidates, isDetecting, progress, failedTiles, tileDebug, detect, dismiss, reset };
}
