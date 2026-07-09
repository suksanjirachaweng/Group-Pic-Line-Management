"use client";

import { useCallback, useState } from "react";
import * as faceapi from "@vladmandic/face-api";

let modelsLoadedPromise: Promise<void> | null = null;
function ensureModelsLoaded(): Promise<void> {
  modelsLoadedPromise ??= faceapi.nets.ssdMobilenetv1.loadFromUri("/models/face-api");
  return modelsLoadedPromise;
}

export type FaceCandidate = { id: string; x: number; y: number; width: number; height: number };

// Full-resolution tiling — confirmed by spike: whole-image downscale-then-detect finds 0 faces
// on wide panoramas (faces become sub-detectable), tiling at native resolution finds ~89% of a
// 377-person crowd in ~7s.
const TILE_WIDTH = 4000;
const TILE_OVERLAP = 300;
const MIN_CONFIDENCE = 0.5;
// Number cards are held below the face — offset the suggested point down by this multiple of
// the detected face height (heuristic from the spike imagery, not exact).
const CARD_Y_OFFSET_FACTOR = 1.8;

type RawBox = { x: number; y: number; width: number; height: number; score: number };

function dedupe(boxes: RawBox[]): RawBox[] {
  const kept: RawBox[] = [];
  for (const b of [...boxes].sort((a, b) => b.score - a.score)) {
    const bcx = b.x + b.width / 2;
    const bcy = b.y + b.height / 2;
    const isDuplicate = kept.some((k) => {
      const kcx = k.x + k.width / 2;
      const kcy = k.y + k.height / 2;
      return Math.hypot(bcx - kcx, bcy - kcy) < Math.max(b.width, k.width) * 0.6;
    });
    if (!isDuplicate) kept.push(b);
  }
  return kept;
}

export function useFaceDetection() {
  const [isDetecting, setIsDetecting] = useState(false);
  const [candidates, setCandidates] = useState<FaceCandidate[]>([]);

  const detect = useCallback(async (fullBitmap: ImageBitmap) => {
    setIsDetecting(true);
    try {
      await ensureModelsLoaded();
      const { width, height } = fullBitmap;
      const numTiles = Math.max(1, Math.ceil((width - TILE_OVERLAP) / (TILE_WIDTH - TILE_OVERLAP)));
      const raw: RawBox[] = [];

      for (let i = 0; i < numTiles; i++) {
        const sx = Math.max(0, i * (TILE_WIDTH - TILE_OVERLAP));
        const sw = Math.min(TILE_WIDTH, width - sx);
        if (sw <= 0) continue;
        const tileCanvas = document.createElement("canvas");
        tileCanvas.width = sw;
        tileCanvas.height = height;
        const ctx = tileCanvas.getContext("2d");
        if (!ctx) continue;
        ctx.drawImage(fullBitmap, sx, 0, sw, height, 0, 0, sw, height);
        const detections = await faceapi.detectAllFaces(
          tileCanvas,
          new faceapi.SsdMobilenetv1Options({ minConfidence: MIN_CONFIDENCE }),
        );
        for (const d of detections) {
          raw.push({ x: d.box.x + sx, y: d.box.y, width: d.box.width, height: d.box.height, score: d.score });
        }
      }

      const kept = dedupe(raw);
      setCandidates(
        kept.map((b, i) => ({
          id: `face-${i}-${Math.round(b.x)}-${Math.round(b.y)}`,
          x: b.x + b.width / 2,
          y: b.y + b.height * CARD_Y_OFFSET_FACTOR,
          width: b.width,
          height: b.height,
        })),
      );
    } finally {
      setIsDetecting(false);
    }
  }, []);

  const dismiss = useCallback((id: string) => {
    setCandidates((prev) => prev.filter((c) => c.id !== id));
  }, []);

  return { candidates, isDetecting, detect, dismiss };
}
