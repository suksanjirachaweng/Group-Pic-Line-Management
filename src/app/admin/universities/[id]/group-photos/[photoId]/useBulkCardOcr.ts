"use client";

import { useCallback, useState } from "react";
import { ocrCardGrid } from "@/lib/actions/bulkCardOcr";
import { extractRectCrop } from "./coordinateMapping";

export type BulkOcrCandidate = { id: string; code: string; x: number; y: number };

// Small tiles (a handful of people per crop) measurably reduce the model's tendency to attribute
// a correctly-read number to a neighboring person's card when many people stand close together in
// a row — verified empirically against a real dense sample photo before shipping this. Bigger
// tiles read faster (fewer API calls) but bind numbers to positions less reliably.
const TILE_SIZE = 600;
const TILE_OVERLAP = 200;
// Each tile is already small (600x600 JPEG, well under 200KB) — per-request payload size isn't
// the bottleneck for a big photo, the sheer number of tiles is (a wide graduation photo can tile
// into several hundred). Higher concurrency is the lever that actually helps; matches the existing
// per-candidate OCR batch's concurrency (see OCR_BATCH_CONCURRENCY in TagCanvas.tsx).
const CONCURRENCY = 8;

function tileStarts(size: number, tile: number, overlap: number): number[] {
  const starts: number[] = [];
  let s = 0;
  while (s < size) {
    starts.push(s);
    if (s + tile >= size) break;
    s += tile - overlap;
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

  const detect = useCallback(async (fullBitmap: ImageBitmap, universityId: string) => {
    setIsDetecting(true);
    setCandidates([]);
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
          const tile = tiles[next++];
          try {
            const blob = await extractRectCrop(
              fullBitmap,
              tile.left,
              tile.top,
              tile.width,
              tile.height,
            );
            const fd = new FormData();
            fd.set("crop", blob, "tile.jpg");
            const { hits } = await ocrCardGrid(universityId, fd);
            for (const hit of hits) {
              // First tile to read a given code wins — with 200px overlap, most cards get read
              // by 2+ neighboring tiles, so this is mainly de-duplication rather than a real
              // confidence choice between candidates.
              if (seenCodes.has(hit.code)) continue;
              seenCodes.add(hit.code);
              found.push({
                id: `bulk-ocr-${hit.code}`,
                code: hit.code,
                x: tile.left + (hit.x / 1000) * tile.width,
                y: tile.top + (hit.y / 1000) * tile.height,
              });
            }
          } catch (err) {
            console.error("Bulk card OCR failed for a tile:", err);
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
  }, []);

  return { candidates, isDetecting, progress, detect, dismiss, reset };
}
