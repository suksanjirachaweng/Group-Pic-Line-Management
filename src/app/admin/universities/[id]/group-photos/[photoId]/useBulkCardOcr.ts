"use client";

import { useCallback, useState } from "react";
import { ocrCardGrid } from "@/lib/actions/bulkCardOcr";
import { deleteOcrTiles } from "@/lib/actions/ocrTileDebug";
import { extractRectCrop } from "@/lib/groupPhoto/coordinateMapping";
import { CONCURRENCY, computeTiles, computeOcrUploadScale } from "@/lib/groupPhoto/tileGeometry";

export type BulkOcrCandidate = { id: string; code: string; x: number; y: number; confident: boolean };

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
  hits: { code: string; x: number; y: number; confident: boolean }[];
  failed: boolean;
};

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

  const detect = useCallback(async (fullBitmap: ImageBitmap, universityId: string, groupPhotoId: string) => {
    setIsDetecting(true);
    setCandidates([]);
    setFailedTiles(0);
    // Revoke the previous run's object URLs before dropping the references, or they leak for the
    // life of the tab (createObjectURL blobs aren't garbage-collected on their own).
    setTileDebug((prev) => {
      for (const t of prev) URL.revokeObjectURL(t.imageUrl);
      return [];
    });
    // Clear whatever this photo's *persisted* debug tiles (GroupPhotoOcrTile, from either this
    // button or the mobile quick-tag cron) still hold from a previous run — otherwise every re-run
    // just piles more tiles on top (5, then 10, then 15...) since ocrCardGrid always inserts, never
    // replaces. Best-effort: a failed clear shouldn't block the OCR run the admin is waiting on.
    try {
      await deleteOcrTiles(universityId, groupPhotoId);
    } catch (err) {
      console.error("Failed to clear previous persisted OCR tiles before a new run:", err);
    }
    try {
      const { width, height } = fullBitmap;
      const tiles = computeTiles(width, height);

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
            const scale = computeOcrUploadScale(tile);
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
              groupPhotoId,
              { tileIndex, left: tile.left, top: tile.top, width: tile.width, height: tile.height },
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
                confident: hit.confident,
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
