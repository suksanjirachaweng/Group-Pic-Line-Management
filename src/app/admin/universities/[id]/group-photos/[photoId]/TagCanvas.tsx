"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { saveGroupPhotoTag, deleteGroupPhotoTag, bulkAdjustTagPositions } from "@/lib/actions/groupPhotos";
import { ocrCardCrop } from "@/lib/actions/ocr";
import { TagMatchSource } from "@/generated/prisma/enums";
import { clientPointToFullRes, fullResToFraction, extractCrop, pixelDistance } from "./coordinateMapping";
import { useFaceDetection, type FaceCandidate } from "./useFaceDetection";
import { TagEditDialog, type DialogInitial, type RegistrantLookup, type ReferenceLookup, type SavePayload } from "./TagEditDialog";
import { validateTags, problemTagIds } from "@/lib/groupPhoto/validateTags";
import { TagLabel, TagDisplayFieldPicker, type TagDisplayField } from "@/lib/groupPhoto/TagLabel";
import { colorForRow } from "@/lib/groupPhoto/rowColor";

const DISPLAY_MAX_WIDTH = 3500;
const OCR_CROP_SIZE = 360;
const OCR_BATCH_CONCURRENCY = 6;
const MIN_SCALE = 0.05;
const MAX_SCALE = 6;
const ZOOM_STEP = 1.25;
const BULK_NUDGE_STEP = 20;

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
}

/** Concurrency-limited OCR pass over every detected face candidate, so results stream in as they
 * resolve rather than waiting for the whole (possibly 300+ person) batch to finish. */
async function runOcrBatch(
  bitmap: ImageBitmap,
  points: FaceCandidate[],
  universityId: string,
  onResult: (id: string, code: string | null) => void,
) {
  let next = 0;
  async function worker() {
    while (next < points.length) {
      const point = points[next++];
      try {
        const crop = await extractCrop(bitmap, point.x, point.y, OCR_CROP_SIZE);
        const fd = new FormData();
        fd.set("crop", crop, "crop.jpg");
        const result = await ocrCardCrop(universityId, fd);
        onResult(point.id, result.code ?? null);
      } catch (err) {
        console.error("Batch OCR failed for a face candidate:", err);
        onResult(point.id, null);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(OCR_BATCH_CONCURRENCY, points.length) }, worker));
}

export type TagRecord = {
  id: string;
  code: string;
  normalizedCode: string;
  name: string;
  row: number;
  order: number;
  x: number;
  y: number;
  registrantId: string | null;
  matchSource: TagMatchSource;
};

export function TagCanvas({
  universityId,
  groupPhotoId,
  imageUrl,
  imageWidth,
  imageHeight,
  initialTags,
  registrants,
  legacyReferences,
}: {
  universityId: string;
  groupPhotoId: string;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  initialTags: TagRecord[];
  registrants: RegistrantLookup[];
  legacyReferences: ReferenceLookup[];
}) {
  const [tags, setTags] = useState<TagRecord[]>(initialTags);
  const [loaded, setLoaded] = useState(false);
  const [scale, setScale] = useState(0.25);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [dialogInitial, setDialogInitial] = useState<DialogInitial | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [candidateCodes, setCandidateCodes] = useState<Record<string, string | null>>({});
  const [candidateOcrPending, setCandidateOcrPending] = useState<Set<string>>(new Set());
  const [displayFields, setDisplayFields] = useState<Set<TagDisplayField>>(
    () => new Set<TagDisplayField>(["code", "name", "line"]),
  );
  const [labelAngle, setLabelAngle] = useState(-30);
  const [hasDetected, setHasDetected] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);
  const [bulkAdjustMode, setBulkAdjustMode] = useState(false);
  const [bulkDx, setBulkDx] = useState(0);
  const [bulkDy, setBulkDy] = useState(0);
  const [bulkScale, setBulkScale] = useState(1);
  const [bulkSaving, setBulkSaving] = useState(false);

  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const fullBitmapRef = useRef<ImageBitmap | null>(null);

  const { candidates: faceCandidates, isDetecting, detect: runFaceDetection, dismiss: dismissCandidate } = useFaceDetection();

  const registrantByCode = useMemo(() => {
    const m = new Map<string, RegistrantLookup>();
    for (const r of registrants) m.set(r.normalizedCode, r);
    return m;
  }, [registrants]);
  const referenceByCode = useMemo(() => {
    const m = new Map<string, ReferenceLookup>();
    for (const r of legacyReferences) m.set(r.normalizedCode, r);
    return m;
  }, [legacyReferences]);

  const problems = useMemo(() => validateTags(tags), [tags]);
  const problemIds = useMemo(() => problemTagIds(problems), [problems]);

  // Anchor for the bulk position adjustment — scaling around the image center is the sensible
  // default when a re-uploaded image shifted everyone (see updateGroupPhotoImage/bulkAdjustTagPositions).
  const bulkAnchorX = imageWidth / 2;
  const bulkAnchorY = imageHeight / 2;
  function previewPoint(t: { x: number; y: number }): { x: number; y: number } {
    if (!bulkAdjustMode) return t;
    return {
      x: bulkAnchorX + (t.x - bulkAnchorX) * bulkScale + bulkDx,
      y: bulkAnchorY + (t.y - bulkAnchorY) * bulkScale + bulkDy,
    };
  }

  // Line segments connecting consecutive `order` positions within the same row — one straight
  // line per adjacent pair, never crossing into the next row.
  const rowLineSegments = useMemo(() => {
    const byRow = new Map<number, TagRecord[]>();
    for (const t of tags) {
      const arr = byRow.get(t.row) ?? [];
      arr.push(t);
      byRow.set(t.row, arr);
    }
    const segments: { key: string; x1: number; y1: number; x2: number; y2: number; color: string }[] = [];
    for (const [row, rowTags] of byRow) {
      const sorted = [...rowTags].sort((a, b) => a.order - b.order);
      const color = colorForRow(row);
      for (let i = 0; i < sorted.length - 1; i++) {
        const pa = previewPoint(sorted[i]);
        const pb = previewPoint(sorted[i + 1]);
        const a = fullResToFraction(pa.x, pa.y, imageWidth, imageHeight);
        const b = fullResToFraction(pb.x, pb.y, imageWidth, imageHeight);
        segments.push({
          key: `${sorted[i].id}-${sorted[i + 1].id}`,
          x1: a.xFrac * 100,
          y1: a.yFrac * 100,
          x2: b.xFrac * 100,
          y2: b.yFrac * 100,
          color,
        });
      }
    }
    return segments;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- previewPoint closes over bulk*/imageWidth/imageHeight, all listed explicitly below
  }, [tags, imageWidth, imageHeight, bulkAdjustMode, bulkDx, bulkDy, bulkScale]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const resp = await fetch(imageUrl);
      const blob = await resp.blob();
      const full = await createImageBitmap(blob);
      if (cancelled) {
        full.close();
        return;
      }
      fullBitmapRef.current = full;

      const targetW = Math.min(DISPLAY_MAX_WIDTH, full.width);
      const displayScale = targetW / full.width;
      const targetH = Math.round(full.height * displayScale);
      const canvas = displayCanvasRef.current;
      if (canvas) {
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(full, 0, 0, targetW, targetH);
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  // Every time a face-detection pass adds candidates, OCR them all right away — the recognized
  // number shows up on the marker itself (no dialog needed) and gets reused, not re-fetched, if
  // the candidate is later promoted into a real tag.
  useEffect(() => {
    const bitmap = fullBitmapRef.current;
    if (!bitmap) return;
    const todo = faceCandidates.filter((c) => !(c.id in candidateCodes) && !candidateOcrPending.has(c.id));
    if (todo.length === 0) return;

    (async () => {
      setCandidateOcrPending((prev) => {
        const next = new Set(prev);
        for (const c of todo) next.add(c.id);
        return next;
      });
      await runOcrBatch(bitmap, todo, universityId, (id, code) => {
        setCandidateCodes((prev) => ({ ...prev, [id]: code }));
        setCandidateOcrPending((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- candidateCodes/candidateOcrPending are read for the "already handled" check, not for re-triggering
  }, [faceCandidates, universityId]);

  function computeNextRowOrder(): { row: number; order: number } {
    const defaultRow = tags.length > 0 ? tags[tags.length - 1].row : 0;
    const maxOrder = tags.filter((t) => t.row === defaultRow).reduce((m, t) => Math.max(m, t.order), -1);
    return { row: defaultRow, order: maxOrder + 1 };
  }

  async function openNewTagDialog(x: number, y: number, precomputedCode?: string | null) {
    const { row, order } = computeNextRowOrder();
    setDialogInitial({ code: precomputedCode ?? "", name: "", row, order, x, y, registrantId: null, matchSource: TagMatchSource.MANUAL });

    // A candidate already OCR'd during the batch face-detection pass — reuse that result instead
    // of paying for a second OCR call on promotion.
    if (precomputedCode !== undefined) return;

    const fullBitmap = fullBitmapRef.current;
    if (!fullBitmap) return;
    setOcrLoading(true);
    try {
      const crop = await extractCrop(fullBitmap, x, y, OCR_CROP_SIZE);
      const fd = new FormData();
      fd.set("crop", crop, "crop.jpg");
      const result = await ocrCardCrop(universityId, fd);
      if (result.code) {
        setDialogInitial((prev) => (prev && !prev.id ? { ...prev, code: result.code! } : prev));
      }
    } catch (err) {
      // OCR is a convenience prefill, not a requirement — leave the code field for manual entry
      // rather than breaking the "add tag" flow on a transient API error.
      console.error("OCR failed, falling back to manual entry:", err);
    } finally {
      setOcrLoading(false);
    }
  }

  function handleCanvasClick(e: ReactMouseEvent<HTMLCanvasElement>) {
    // The browser still fires a native "click" on mouseup even after a drag pan (same element for
    // mousedown/mouseup) — swallow that one click rather than opening a new-tag dialog. Also
    // swallow plain clicks while Space is held (Photoshop's Hand tool doesn't add anything either)
    // or while bulk-adjusting (that's a dedicated mode, not a moment to add a new person).
    if (draggedRef.current || spacePressed || bulkAdjustMode) {
      draggedRef.current = false;
      return;
    }
    const canvas = displayCanvasRef.current;
    if (!canvas) return;
    const { x, y } = clientPointToFullRes(e.clientX, e.clientY, canvas, imageWidth, imageHeight);
    void openNewTagDialog(x, y);
  }

  function handleCanvasDoubleClick(e: ReactMouseEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const canvas = displayCanvasRef.current;
    if (!canvas || tags.length === 0 || bulkAdjustMode) return;
    const { x, y } = clientPointToFullRes(e.clientX, e.clientY, canvas, imageWidth, imageHeight);
    let nearest = tags[0];
    let best = pixelDistance(x, y, nearest.x, nearest.y);
    for (const t of tags) {
      const d = pixelDistance(x, y, t.x, t.y);
      if (d < best) {
        best = d;
        nearest = t;
      }
    }
    setDialogInitial(nearest);
  }

  function handlePromoteCandidate(candidateId: string, x: number, y: number) {
    const knownCode = candidateCodes[candidateId];
    dismissCandidate(candidateId);
    void openNewTagDialog(x, y, knownCode ?? undefined);
  }

  async function handleSave(input: SavePayload) {
    if (!dialogInitial) return;
    const result = await saveGroupPhotoTag(universityId, groupPhotoId, {
      id: dialogInitial.id,
      code: input.code,
      name: input.name,
      row: input.row,
      order: input.order,
      x: dialogInitial.x,
      y: dialogInitial.y,
      registrantId: input.registrantId,
      matchSource: input.matchSource,
    });
    const normalizedCode = input.code.replace(/\D+/g, "");
    if (dialogInitial.id) {
      const id = dialogInitial.id;
      setTags((prev) => prev.map((t) => (t.id === id ? { ...t, ...input, normalizedCode } : t)));
    } else {
      setTags((prev) => [...prev, { id: result.id, x: dialogInitial.x, y: dialogInitial.y, ...input, normalizedCode }]);
    }
    setDialogInitial(null);
  }

  async function handleDelete() {
    if (!dialogInitial?.id) return;
    const id = dialogInitial.id;
    await deleteGroupPhotoTag(universityId, groupPhotoId, id);
    setTags((prev) => prev.filter((t) => t.id !== id));
    setDialogInitial(null);
  }

  function zoomBy(factor: number) {
    setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * factor)));
  }

  function resetBulkAdjust() {
    setBulkAdjustMode(false);
    setBulkDx(0);
    setBulkDy(0);
    setBulkScale(1);
  }

  async function handleBulkSave() {
    setBulkSaving(true);
    try {
      await bulkAdjustTagPositions(universityId, groupPhotoId, {
        dx: bulkDx,
        dy: bulkDy,
        scale: bulkScale,
        anchorX: bulkAnchorX,
        anchorY: bulkAnchorY,
      });
      setTags((prev) => prev.map((t) => ({ ...t, ...previewPoint(t) })));
      resetBulkAdjust();
    } catch (err) {
      window.alert(`บันทึกตำแหน่งใหม่ไม่สำเร็จ: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setBulkSaving(false);
    }
  }

  // Photoshop-style shortcuts: hold Space to pan-drag, Ctrl/Cmd +/- to zoom. Ignored while typing
  // in a text field (e.g. the tag dialog's name input needs a literal space character).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      if (e.code === "Space") {
        e.preventDefault();
        setSpacePressed(true);
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "+" || e.key === "=") {
          e.preventDefault();
          zoomBy(ZOOM_STEP);
        } else if (e.key === "-" || e.key === "_") {
          e.preventDefault();
          zoomBy(1 / ZOOM_STEP);
        }
      }
    }
    function handleKeyUp(e: KeyboardEvent) {
      if (e.code === "Space") setSpacePressed(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const draggingRef = useRef<{ x: number; y: number } | null>(null);
  const draggedRef = useRef(false);
  function handleMouseDown(e: ReactMouseEvent) {
    if (!spacePressed && e.button !== 1) return;
    draggingRef.current = { x: e.clientX - tx, y: e.clientY - ty };
  }
  function handleMouseMove(e: ReactMouseEvent) {
    if (!draggingRef.current) return;
    draggedRef.current = true;
    setTx(e.clientX - draggingRef.current.x);
    setTy(e.clientY - draggingRef.current.y);
  }
  function handleMouseUp() {
    draggingRef.current = null;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-3 py-2 text-xs">
        <span className="text-gray-600">แท็กแล้ว {tags.length} คน</span>
        {problems.length > 0 && (
          <span className="rounded bg-red-50 px-2 py-0.5 font-medium text-red-700">{problems.length} ปัญหา</span>
        )}

        <div className="mx-1 h-5 w-px bg-gray-200" />

        <TagDisplayFieldPicker value={displayFields} onChange={setDisplayFields} />

        <label className="flex items-center gap-1 text-gray-600">
          มุมป้าย
          <input
            type="number"
            value={labelAngle}
            onChange={(e) => setLabelAngle(Number(e.target.value))}
            step={5}
            className="w-14 rounded-md border border-gray-300 px-1.5 py-1"
          />
        </label>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => zoomBy(1 / ZOOM_STEP)}
            title="Zoom out (Ctrl -)"
            className="rounded-md border border-gray-300 px-2.5 py-1.5 font-medium text-gray-700 hover:bg-gray-50"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => zoomBy(ZOOM_STEP)}
            title="Zoom in (Ctrl +)"
            className="rounded-md border border-gray-300 px-2.5 py-1.5 font-medium text-gray-700 hover:bg-gray-50"
          >
            +
          </button>
        </div>

        <div className="mx-1 h-5 w-px bg-gray-200" />

        <button
          type="button"
          disabled={!loaded || isDetecting || hasDetected}
          onClick={() => {
            if (!fullBitmapRef.current) return;
            setHasDetected(true);
            runFaceDetection(fullBitmapRef.current);
          }}
          title={hasDetected ? "ตรวจจับไปแล้วในรูปนี้ — กดซ้ำจะได้ผลลัพธ์เดิม" : "ช่วยแนะนำตำแหน่งคนที่ยังไม่ได้แท็ก"}
          className="rounded-md border border-gray-300 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {isDetecting ? "กำลังตรวจจับ..." : hasDetected ? "ตรวจจับแล้ว" : "ตรวจจับใบหน้า"}
        </button>
        <button
          type="button"
          disabled={tags.length === 0 || bulkAdjustMode}
          onClick={() => setBulkAdjustMode(true)}
          title="เลื่อน/ย่อขยายจุดที่แท็กไว้ทั้งหมดพร้อมกัน — ใช้เมื่ออัปเดตรูปแล้วตำแหน่งเพี้ยน"
          className="rounded-md border border-gray-300 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          ปรับตำแหน่ง
        </button>

        <span className="ml-auto hidden text-gray-400 lg:inline">
          Space+ลาก = เลื่อน, Ctrl +/- = ซูม, คลิก = เพิ่มคน, ดับเบิลคลิก = แก้ไข
        </span>
      </div>

      <div
        className="relative flex-1 overflow-hidden bg-gray-800"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})` }}>
          <canvas
            ref={displayCanvasRef}
            onClick={handleCanvasClick}
            onDoubleClick={handleCanvasDoubleClick}
            className={`block ${spacePressed ? "cursor-grab" : "cursor-crosshair"}`}
          />
          <div className="pointer-events-none absolute inset-0">
            {displayFields.has("line") && (
              <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                {rowLineSegments.map((seg) => (
                  <line
                    key={seg.key}
                    x1={seg.x1}
                    y1={seg.y1}
                    x2={seg.x2}
                    y2={seg.y2}
                    stroke={seg.color}
                    strokeWidth={0.45}
                    strokeLinecap="round"
                  />
                ))}
              </svg>
            )}
            {tags.map((t) => {
              const p = previewPoint(t);
              const { xFrac, yFrac } = fullResToFraction(p.x, p.y, imageWidth, imageHeight);
              const isProblem = problemIds.has(t.id);
              const color = colorForRow(t.row);
              return (
                <div
                  key={t.id}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${xFrac * 100}%`, top: `${yFrac * 100}%` }}
                >
                  <div
                    className="rounded-full border-2 border-white"
                    style={{
                      width: 12,
                      height: 12,
                      backgroundColor: color,
                      boxShadow: isProblem ? "0 0 0 2px #ef4444" : undefined,
                    }}
                    title={`${t.code} — ${t.name}`}
                  />
                  <TagLabel order={t.order} code={t.code} name={t.name} color={color} fields={displayFields} angle={labelAngle} />
                </div>
              );
            })}
            {faceCandidates.map((c) => {
              const { xFrac, yFrac } = fullResToFraction(c.x, c.y, imageWidth, imageHeight);
              const code = candidateCodes[c.id];
              const pending = candidateOcrPending.has(c.id);
              return (
                <div
                  key={c.id}
                  className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${xFrac * 100}%`, top: `${yFrac * 100}%` }}
                >
                  <button
                    type="button"
                    className="rounded-full border-2 border-dashed border-sky-400 bg-sky-400/10 hover:bg-sky-400/30"
                    style={{ width: 16, height: 16 }}
                    onClick={() => handlePromoteCandidate(c.id, c.x, c.y)}
                    title="คลิกเพื่อเพิ่มคนนี้"
                  />
                  {code && (
                    <div className="pointer-events-none absolute left-1/2 top-full mt-0.5 -translate-x-1/2 whitespace-nowrap rounded bg-sky-700/80 px-1 text-[10px] leading-tight text-white">
                      {code}
                    </div>
                  )}
                  {pending && !code && (
                    <div className="pointer-events-none absolute left-1/2 top-full mt-0.5 -translate-x-1/2 whitespace-nowrap text-[10px] text-sky-200">
                      …
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {bulkAdjustMode && (
          <div className="absolute right-3 top-3 z-20 w-64 rounded-lg border border-gray-200 bg-white p-3 shadow-xl">
            <p className="mb-2 text-xs font-semibold text-gray-900">ปรับตำแหน่งทั้งหมด ({tags.length} คน)</p>
            <div className="mb-2 grid grid-cols-3 gap-1">
              <div />
              <button
                type="button"
                onClick={() => setBulkDy((d) => d - BULK_NUDGE_STEP)}
                className="rounded-md border border-gray-300 py-1 text-sm hover:bg-gray-50"
              >
                ↑
              </button>
              <div />
              <button
                type="button"
                onClick={() => setBulkDx((d) => d - BULK_NUDGE_STEP)}
                className="rounded-md border border-gray-300 py-1 text-sm hover:bg-gray-50"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => {
                  setBulkDx(0);
                  setBulkDy(0);
                }}
                className="rounded-md border border-gray-300 py-1 text-[10px] hover:bg-gray-50"
              >
                รีเซ็ต
              </button>
              <button
                type="button"
                onClick={() => setBulkDx((d) => d + BULK_NUDGE_STEP)}
                className="rounded-md border border-gray-300 py-1 text-sm hover:bg-gray-50"
              >
                →
              </button>
              <div />
              <button
                type="button"
                onClick={() => setBulkDy((d) => d + BULK_NUDGE_STEP)}
                className="rounded-md border border-gray-300 py-1 text-sm hover:bg-gray-50"
              >
                ↓
              </button>
              <div />
            </div>

            <div className="mb-2 grid grid-cols-2 gap-2 text-xs text-gray-600">
              <label>
                dx (px)
                <input
                  type="number"
                  value={bulkDx}
                  onChange={(e) => setBulkDx(Number(e.target.value))}
                  className="mt-0.5 w-full rounded-md border border-gray-300 px-1.5 py-1"
                />
              </label>
              <label>
                dy (px)
                <input
                  type="number"
                  value={bulkDy}
                  onChange={(e) => setBulkDy(Number(e.target.value))}
                  className="mt-0.5 w-full rounded-md border border-gray-300 px-1.5 py-1"
                />
              </label>
            </div>

            <label className="mb-1 flex items-center justify-between text-xs text-gray-600">
              ขนาด (scale)
              <span>{Math.round(bulkScale * 100)}%</span>
            </label>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.01}
              value={bulkScale}
              onChange={(e) => setBulkScale(Number(e.target.value))}
              className="mb-3 w-full"
            />

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={resetBulkAdjust}
                className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleBulkSave}
                disabled={bulkSaving}
                className="rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {bulkSaving ? "กำลังบันทึก..." : "บันทึกตำแหน่งใหม่"}
              </button>
            </div>
          </div>
        )}
      </div>

      <TagEditDialog
        open={!!dialogInitial}
        initial={dialogInitial}
        ocrLoading={ocrLoading}
        registrantByCode={registrantByCode}
        referenceByCode={referenceByCode}
        onSave={handleSave}
        onDelete={dialogInitial?.id ? handleDelete : undefined}
        onClose={() => setDialogInitial(null)}
      />
    </div>
  );
}
