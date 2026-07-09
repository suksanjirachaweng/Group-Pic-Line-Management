"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type WheelEvent as ReactWheelEvent } from "react";
import { saveGroupPhotoTag, deleteGroupPhotoTag } from "@/lib/actions/groupPhotos";
import { ocrCardCrop } from "@/lib/actions/ocr";
import { TagMatchSource } from "@/generated/prisma/enums";
import { clientPointToFullRes, fullResToFraction, extractCrop, pixelDistance } from "./coordinateMapping";
import { useFaceDetection } from "./useFaceDetection";
import { TagEditDialog, type DialogInitial, type RegistrantLookup, type ReferenceLookup, type SavePayload } from "./TagEditDialog";
import { validateTags, problemTagIds } from "@/lib/groupPhoto/validateTags";

const DISPLAY_MAX_WIDTH = 3500;
const OCR_CROP_SIZE = 360;

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

  function computeNextRowOrder(): { row: number; order: number } {
    const defaultRow = tags.length > 0 ? tags[tags.length - 1].row : 0;
    const maxOrder = tags.filter((t) => t.row === defaultRow).reduce((m, t) => Math.max(m, t.order), -1);
    return { row: defaultRow, order: maxOrder + 1 };
  }

  async function openNewTagDialog(x: number, y: number) {
    const { row, order } = computeNextRowOrder();
    setDialogInitial({ code: "", name: "", row, order, x, y, registrantId: null, matchSource: TagMatchSource.MANUAL });

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
    const canvas = displayCanvasRef.current;
    if (!canvas) return;
    const { x, y } = clientPointToFullRes(e.clientX, e.clientY, canvas, imageWidth, imageHeight);
    void openNewTagDialog(x, y);
  }

  function handleCanvasDoubleClick(e: ReactMouseEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const canvas = displayCanvasRef.current;
    if (!canvas || tags.length === 0) return;
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
    dismissCandidate(candidateId);
    void openNewTagDialog(x, y);
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

  const draggingRef = useRef<{ x: number; y: number } | null>(null);
  function handleMouseDown(e: ReactMouseEvent) {
    if (!e.shiftKey && e.button !== 1) return;
    draggingRef.current = { x: e.clientX - tx, y: e.clientY - ty };
  }
  function handleMouseMove(e: ReactMouseEvent) {
    if (!draggingRef.current) return;
    setTx(e.clientX - draggingRef.current.x);
    setTy(e.clientY - draggingRef.current.y);
  }
  function handleMouseUp() {
    draggingRef.current = null;
  }
  function handleWheel(e: ReactWheelEvent) {
    e.preventDefault();
    setScale((s) => Math.min(6, Math.max(0.05, s * (e.deltaY < 0 ? 1.15 : 0.87))));
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-gray-200 bg-white px-3 py-2 text-sm">
        <span className="text-gray-600">แท็กแล้ว {tags.length} คน</span>
        {problems.length > 0 && (
          <span className="rounded bg-red-50 px-2 py-0.5 text-xs text-red-700">{problems.length} รายการมีปัญหา</span>
        )}
        <button
          type="button"
          disabled={!loaded || isDetecting}
          onClick={() => fullBitmapRef.current && runFaceDetection(fullBitmapRef.current)}
          className="ml-auto rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {isDetecting ? "กำลังตรวจจับใบหน้า..." : "ตรวจจับใบหน้า (ช่วยแนะนำตำแหน่ง)"}
        </button>
        <Link
          href={`/admin/universities/${universityId}/group-photos/${groupPhotoId}/validate`}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
        >
          ตรวจสอบ / Export
        </Link>
        <span className="hidden text-xs text-gray-400 lg:inline">
          Shift+ลาก = เลื่อนภาพ, scroll = ซูม, คลิก = เพิ่มคน, ดับเบิลคลิก = แก้ไขคนที่ใกล้ที่สุด
        </span>
      </div>

      <div
        className="relative flex-1 overflow-hidden bg-gray-800"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})` }}>
          <canvas ref={displayCanvasRef} onClick={handleCanvasClick} onDoubleClick={handleCanvasDoubleClick} className="block cursor-crosshair" />
          <div className="pointer-events-none absolute inset-0">
            {tags.map((t) => {
              const { xFrac, yFrac } = fullResToFraction(t.x, t.y, imageWidth, imageHeight);
              const isProblem = problemIds.has(t.id);
              return (
                <div
                  key={t.id}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${
                    isProblem ? "border-red-500 bg-red-500/30" : "border-lime-400 bg-lime-400/20"
                  }`}
                  style={{ left: `${xFrac * 100}%`, top: `${yFrac * 100}%`, width: 24, height: 24 }}
                  title={`${t.code} — ${t.name}`}
                />
              );
            })}
            {faceCandidates.map((c) => {
              const { xFrac, yFrac } = fullResToFraction(c.x, c.y, imageWidth, imageHeight);
              return (
                <button
                  key={c.id}
                  type="button"
                  className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-sky-400 bg-sky-400/10 hover:bg-sky-400/30"
                  style={{ left: `${xFrac * 100}%`, top: `${yFrac * 100}%`, width: 20, height: 20 }}
                  onClick={() => handlePromoteCandidate(c.id, c.x, c.y)}
                  title="คลิกเพื่อเพิ่มคนนี้"
                />
              );
            })}
          </div>
        </div>
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
