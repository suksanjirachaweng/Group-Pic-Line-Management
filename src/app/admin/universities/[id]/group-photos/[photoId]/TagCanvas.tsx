"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  saveGroupPhotoTag,
  deleteGroupPhotoTag,
  bulkAdjustTagPositions,
  moveGroupPhotoTag,
} from "@/lib/actions/groupPhotos";
import { ocrCardCrop } from "@/lib/actions/ocr";
import { TagMatchSource } from "@/generated/prisma/enums";
import {
  clientPointToFullRes,
  fullResToFraction,
  extractCrop,
  pixelDistance,
} from "./coordinateMapping";
import { useFaceDetection, type FaceCandidate } from "./useFaceDetection";
import {
  TagEditDialog,
  type DialogInitial,
  type RegistrantLookup,
  type ReferenceLookup,
  type SavePayload,
} from "./TagEditDialog";
import { validateTags, problemTagIds } from "@/lib/groupPhoto/validateTags";
import { normalizeCode } from "@/lib/groupPhoto/normalizeCode";
import {
  TagLabel,
  TagMarker,
  TagDisplayFieldPicker,
  type TagDisplayField,
} from "@/lib/groupPhoto/TagLabel";
import { TagListSidebar } from "@/lib/groupPhoto/TagListSidebar";
import { colorForRow } from "@/lib/groupPhoto/rowColor";
import { ZoomButtons } from "@/lib/groupPhoto/ZoomButtons";

const DISPLAY_MAX_WIDTH = 3500;
const OCR_CROP_SIZE = 360;
const OCR_BATCH_CONCURRENCY = 6;
const MIN_SCALE = 0.05;
const MAX_SCALE = 6;
const ZOOM_STEP = 1.25;
const BULK_NUDGE_STEP = 20;
const SEARCH_ZOOM = 1.2;
const DOUBLE_CLICK_MAX_SCREEN_PX = 30;
const GRAY_MARKER_COLOR = "#9ca3af";

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return (
    el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable
  );
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
  await Promise.all(
    Array.from(
      { length: Math.min(OCR_BATCH_CONCURRENCY, points.length) },
      worker,
    ),
  );
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
  reportedProblem: boolean;
};

/**
 * Mirrors saveGroupPhotoTag's row/order "insert, don't collide" shift locally so the in-memory
 * tag list matches the DB immediately after a save, without a refetch. Must stay in lockstep with
 * that server action's logic — see its comment for why each branch shifts the way it does.
 */
function applyRowOrderShift(
  prevTags: TagRecord[],
  savedId: string | undefined,
  targetRow: number,
  targetOrder: number,
): TagRecord[] {
  const existing = savedId ? prevTags.find((t) => t.id === savedId) : undefined;
  if (!existing) {
    return prevTags.map((t) =>
      t.row === targetRow && t.order >= targetOrder
        ? { ...t, order: t.order + 1 }
        : t,
    );
  }
  if (existing.row === targetRow) {
    if (targetOrder > existing.order) {
      return prevTags.map((t) =>
        t.id !== savedId &&
        t.row === targetRow &&
        t.order > existing.order &&
        t.order <= targetOrder
          ? { ...t, order: t.order - 1 }
          : t,
      );
    }
    if (targetOrder < existing.order) {
      return prevTags.map((t) =>
        t.id !== savedId &&
        t.row === targetRow &&
        t.order >= targetOrder &&
        t.order < existing.order
          ? { ...t, order: t.order + 1 }
          : t,
      );
    }
    return prevTags;
  }
  return prevTags.map((t) => {
    if (t.id === savedId) return t;
    if (t.row === existing.row && t.order > existing.order)
      return { ...t, order: t.order - 1 };
    if (t.row === targetRow && t.order >= targetOrder)
      return { ...t, order: t.order + 1 };
    return t;
  });
}

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
  // Computed synchronously from the known full-res dimensions (the same capping formula the load
  // effect below uses once it has the real decoded bitmap) so the canvas — and every tag marker
  // positioned over it — is correctly sized from the very first render, instead of sitting
  // collapsed in a tiny top-left corner until the image fetch/decode finishes.
  const [canvasSize, setCanvasSize] = useState<{
    width: number;
    height: number;
  }>(() => {
    const targetW = Math.min(DISPLAY_MAX_WIDTH, imageWidth);
    const targetH = Math.round(imageHeight * (targetW / imageWidth));
    return { width: targetW, height: targetH };
  });
  const [scale, setScale] = useState(0.25);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [dialogInitial, setDialogInitial] = useState<DialogInitial | null>(
    null,
  );
  const [ocrEnabled, setOcrEnabled] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [candidateCodes, setCandidateCodes] = useState<
    Record<string, string | null>
  >({});
  const [candidateOcrPending, setCandidateOcrPending] = useState<Set<string>>(
    new Set(),
  );
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
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(-1);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [listMode, setListMode] = useState<"problems" | "all">("problems");

  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const fullBitmapRef = useRef<ImageBitmap | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    candidates: faceCandidates,
    isDetecting,
    detect: runFaceDetection,
    dismiss: dismissCandidate,
  } = useFaceDetection();

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
  const reportedCount = useMemo(
    () => tags.filter((t) => t.reportedProblem).length,
    [tags],
  );

  // Search by code or name/surname — cycles through matches on repeated search, jumping the
  // viewport to each one in turn (Ctrl-F-style "find next"), which matters once a photo has
  // hundreds of tags spread across a huge image.
  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const qCode = normalizeCode(searchQuery);
    return tags.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.code.toLowerCase().includes(q) ||
        (qCode && t.normalizedCode.includes(qCode)),
    );
  }, [tags, searchQuery]);
  const highlightedTagId =
    searchIndex >= 0 ? searchMatches[searchIndex]?.id : undefined;

  function centerOn(
    x: number,
    y: number,
    opts?: { onlyIfOffscreen?: boolean },
  ) {
    const canvas = displayCanvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const displayX = (x / imageWidth) * canvas.width;
    const displayY = (y / imageHeight) * canvas.height;
    const rect = container.getBoundingClientRect();
    if (opts?.onlyIfOffscreen) {
      const screenX = tx + displayX * scale;
      const screenY = ty + displayY * scale;
      const margin = 48;
      const alreadyVisible =
        screenX >= margin &&
        screenX <= rect.width - margin &&
        screenY >= margin &&
        screenY <= rect.height - margin;
      if (alreadyVisible) return;
    }
    const targetScale = Math.max(scale, SEARCH_ZOOM);
    setScale(targetScale);
    setTx(rect.width / 2 - displayX * targetScale);
    setTy(rect.height / 2 - displayY * targetScale);
  }

  function handleSearchNext() {
    if (searchMatches.length === 0) return;
    const idx = (searchIndex + 1 + searchMatches.length) % searchMatches.length;
    setSearchIndex(idx);
    centerOn(searchMatches[idx].x, searchMatches[idx].y);
  }

  function handleSearchChange(value: string) {
    setSearchQuery(value);
    setSearchIndex(-1);
  }

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
    const segments: {
      key: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color: string;
    }[] = [];
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
  }, [
    tags,
    imageWidth,
    imageHeight,
    bulkAdjustMode,
    bulkDx,
    bulkDy,
    bulkScale,
  ]);

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
      setCanvasSize({ width: targetW, height: targetH });
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
    if (!ocrEnabled) return;
    const bitmap = fullBitmapRef.current;
    if (!bitmap) return;
    const todo = faceCandidates.filter(
      (c) => !(c.id in candidateCodes) && !candidateOcrPending.has(c.id),
    );
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
  }, [faceCandidates, universityId, ocrEnabled]);

  // Suggests where a new point probably belongs, so adding a missed person doesn't always start
  // from a blank "row 0" guess — both fields stay manually editable in the dialog either way,
  // same as the legacy tool where a human always picked the row themselves.
  function suggestRowOrder(
    x: number,
    y: number,
  ): { row: number; order: number } {
    if (tags.length === 0) return { row: 0, order: 0 };
    // Default row: whichever existing tag is geometrically closest to the click — a new person
    // is almost always tagged right next to who they're standing/sitting beside.
    let nearest = tags[0];
    let best = pixelDistance(x, y, nearest.x, nearest.y);
    for (const t of tags) {
      const d = pixelDistance(x, y, t.x, t.y);
      if (d < best) {
        best = d;
        nearest = t;
      }
    }
    // Default order: insert left-to-right by X position among that row's existing tags, so a
    // person missed in the middle of an already-tagged row lands between their real neighbors —
    // saving then shifts everyone from that slot onward over by one automatically (server + local
    // state both apply the same shift, see applyRowOrderShift).
    const order = tags.filter((t) => t.row === nearest.row && t.x < x).length;
    return { row: nearest.row, order };
  }

  async function openNewTagDialog(
    x: number,
    y: number,
    precomputedCode?: string | null,
  ) {
    setSelectedTagId(null);
    const { row, order } = suggestRowOrder(x, y);
    setDialogInitial({
      code: precomputedCode ?? "",
      name: "",
      row,
      order,
      x,
      y,
      registrantId: null,
      matchSource: TagMatchSource.MANUAL,
    });

    // A candidate already OCR'd during the batch face-detection pass — reuse that result instead
    // of paying for a second OCR call on promotion.
    if (precomputedCode !== undefined) return;
    if (!ocrEnabled) return;

    const fullBitmap = fullBitmapRef.current;
    if (!fullBitmap) return;
    setOcrLoading(true);
    try {
      const crop = await extractCrop(fullBitmap, x, y, OCR_CROP_SIZE);
      const fd = new FormData();
      fd.set("crop", crop, "crop.jpg");
      const result = await ocrCardCrop(universityId, fd);
      if (result.code) {
        setDialogInitial((prev) =>
          prev && !prev.id ? { ...prev, code: result.code! } : prev,
        );
      }
    } catch (err) {
      // OCR is a convenience prefill, not a requirement — leave the code field for manual entry
      // rather than breaking the "add tag" flow on a transient API error.
      console.error("OCR failed, falling back to manual entry:", err);
    } finally {
      setOcrLoading(false);
    }
  }

  // A genuine double-click still fires its own separate "click" event on the second mouseup
  // (browsers always dispatch click, click, dblclick for that gesture) — without this delay, a
  // Shift-held double-click would briefly open an "add new" dialog (and kick off an OCR request)
  // a moment before the double-click handler below replaced it with the intended "edit" dialog.
  // Deferring the "add new" action lets a following double-click cancel it outright instead of
  // racing it. Plain (non-Shift) double-clicks never reach this at all now, per the legacy tool's
  // own convention: Shift+click = add a new point, double-click = edit the nearest existing one.
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    };
  }, []);

  // Shared nearest-tag lookup, used by both double-click-to-edit and plain-click-to-select/drag —
  // getBoundingClientRect() already reflects the current CSS pan/zoom transform, so this ratio
  // converts a fixed on-screen click radius into full-res pixels correctly at any zoom level,
  // rather than tracking the `scale` state separately.
  function findNearestTagWithinThreshold(
    clientX: number,
    clientY: number,
  ): TagRecord | null {
    const canvas = displayCanvasRef.current;
    if (!canvas || tags.length === 0) return null;
    const { x, y } = clientPointToFullRes(
      clientX,
      clientY,
      canvas,
      imageWidth,
      imageHeight,
    );
    let nearest = tags[0];
    let best = pixelDistance(x, y, nearest.x, nearest.y);
    for (const t of tags) {
      const d = pixelDistance(x, y, t.x, t.y);
      if (d < best) {
        best = d;
        nearest = t;
      }
    }
    const rect = canvas.getBoundingClientRect();
    const maxDistance = DOUBLE_CLICK_MAX_SCREEN_PX * (imageWidth / rect.width);
    return best <= maxDistance ? nearest : null;
  }

  function handleCanvasClick(e: ReactMouseEvent<HTMLCanvasElement>) {
    // The browser still fires a native "click" on mouseup even after a drag pan (same element for
    // mousedown/mouseup) — swallow that one click rather than opening a new-tag dialog. Also
    // swallow plain clicks while Space is held (Photoshop's Hand tool doesn't add anything either),
    // or while bulk-adjusting (that's a dedicated mode, not a moment to add a new person).
    if (draggedRef.current || spacePressed || bulkAdjustMode) {
      draggedRef.current = false;
      return;
    }
    // A plain click/drag that started on an existing tag was already handled entirely in
    // handleMouseDown/handleMouseUp (select or reposition) — swallow the click that inevitably
    // follows so it doesn't also fall through to the deselect/add-new logic below.
    if (tagInteractedRef.current) {
      tagInteractedRef.current = false;
      return;
    }
    if (!e.shiftKey) {
      setSelectedTagId(null);
      return;
    }
    const canvas = displayCanvasRef.current;
    if (!canvas) return;
    const { x, y } = clientPointToFullRes(
      e.clientX,
      e.clientY,
      canvas,
      imageWidth,
      imageHeight,
    );
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      void openNewTagDialog(x, y);
    }, 250);
  }

  function handleCanvasDoubleClick(e: ReactMouseEvent<HTMLCanvasElement>) {
    e.preventDefault();
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    if (bulkAdjustMode) return;
    const nearest = findNearestTagWithinThreshold(e.clientX, e.clientY);
    if (!nearest) return;
    setSelectedTagId(null);
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
    setTags((prev) => {
      const shifted = applyRowOrderShift(
        prev,
        dialogInitial.id,
        input.row,
        input.order,
      );
      if (dialogInitial.id) {
        const id = dialogInitial.id;
        return shifted.map((t) =>
          t.id === id ? { ...t, ...input, normalizedCode } : t,
        );
      }
      return [
        ...shifted,
        {
          id: result.id,
          x: dialogInitial.x,
          y: dialogInitial.y,
          ...input,
          normalizedCode,
          reportedProblem: false,
        },
      ];
    });
    setDialogInitial(null);
  }

  async function handleDelete() {
    if (!dialogInitial?.id) return;
    const id = dialogInitial.id;
    await deleteGroupPhotoTag(universityId, groupPhotoId, id);
    setTags((prev) => prev.filter((t) => t.id !== id));
    setDialogInitial(null);
  }

  // Anchors the zoom at the viewport's current center (in screen space) instead of the content's
  // top-left transform-origin, so the point you were looking at stays put instead of the view
  // drifting toward the corner on every zoom step.
  function zoomBy(factor: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    setScale((s) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * factor));
      if (rect && next !== s) {
        const ratio = next / s;
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        setTx((t) => cx - (cx - t) * ratio);
        setTy((t) => cy - (cy - t) * ratio);
      }
      return next;
    });
  }

  // Scales/centers so the whole image just fits the viewport — the same "reset zoom" gesture as
  // Ctrl+0 in browsers/design tools, useful after zooming/panning deep into a huge photo.
  function zoomToFit() {
    const canvas = displayCanvasRef.current;
    const rect = containerRef.current?.getBoundingClientRect();
    if (
      !canvas ||
      !rect ||
      !canvas.width ||
      !canvas.height ||
      !rect.width ||
      !rect.height
    )
      return;
    const next = Math.min(
      MAX_SCALE,
      Math.max(
        MIN_SCALE,
        Math.min(rect.width / canvas.width, rect.height / canvas.height),
      ),
    );
    setScale(next);
    setTx((rect.width - canvas.width * next) / 2);
    setTy((rect.height - canvas.height * next) / 2);
  }

  // Open already fit to the viewport instead of the fixed 0.25 default — safe to run on mount
  // now that the canvas is sized synchronously from imageWidth/imageHeight (see canvasSize
  // above), so both it and the container already have real dimensions before this fires.
  useEffect(() => {
    zoomToFit();
  }, []);

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
      window.alert(
        `บันทึกตำแหน่งใหม่ไม่สำเร็จ: ${err instanceof Error ? err.message : "unknown error"}`,
      );
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
        } else if (e.key === "0") {
          e.preventDefault();
          zoomToFit();
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
  // A plain mousedown that lands on an existing tag starts a "select or drag" gesture: released
  // without moving = select that point (matches the legacy tool's "click = select"); released
  // after moving = the point follows the cursor and its new x/y is saved. Space+drag still pans
  // the whole canvas — this only engages for a plain, unmodified left mousedown on a tag.
  const draggingTagRef = useRef<string | null>(null);
  const tagInteractedRef = useRef(false);
  const dragMovedRef = useRef(false);

  function handleMouseDown(e: ReactMouseEvent) {
    if (spacePressed || e.button === 1) {
      draggingRef.current = { x: e.clientX - tx, y: e.clientY - ty };
      return;
    }
    if (e.button !== 0 || bulkAdjustMode || e.shiftKey) return;
    const nearest = findNearestTagWithinThreshold(e.clientX, e.clientY);
    if (nearest) {
      draggingTagRef.current = nearest.id;
      tagInteractedRef.current = true;
      dragMovedRef.current = false;
    }
  }
  function handleMouseMove(e: ReactMouseEvent) {
    if (draggingRef.current) {
      draggedRef.current = true;
      setTx(e.clientX - draggingRef.current.x);
      setTy(e.clientY - draggingRef.current.y);
      return;
    }
    if (draggingTagRef.current) {
      const canvas = displayCanvasRef.current;
      if (!canvas) return;
      dragMovedRef.current = true;
      const { x, y } = clientPointToFullRes(
        e.clientX,
        e.clientY,
        canvas,
        imageWidth,
        imageHeight,
      );
      setDragPreview({ id: draggingTagRef.current, x, y });
    }
  }
  function handleMouseUp() {
    draggingRef.current = null;
    const tagId = draggingTagRef.current;
    if (!tagId) return;
    draggingTagRef.current = null;
    if (!dragMovedRef.current) {
      setSelectedTagId(tagId);
      dragMovedRef.current = false;
      return;
    }
    dragMovedRef.current = false;
    setDragPreview((preview) => {
      if (preview && preview.id === tagId) {
        const { x, y } = preview;
        const original = tags.find((t) => t.id === tagId);
        setTags((prev) =>
          prev.map((t) => (t.id === tagId ? { ...t, x, y } : t)),
        );
        moveGroupPhotoTag(universityId, groupPhotoId, tagId, x, y).catch(
          (err) => {
            window.alert(
              `ย้ายตำแหน่งไม่สำเร็จ: ${err instanceof Error ? err.message : "unknown error"}`,
            );
            if (original)
              setTags((prev) =>
                prev.map((t) => (t.id === tagId ? original : t)),
              );
          },
        );
      }
      return null;
    });
    setSelectedTagId(tagId);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <TagListSidebar
          tags={tags}
          selectedTagId={selectedTagId}
          onSelectTag={(t) => {
            if (t) {
              setSelectedTagId(t.id);
              // Only pans/zooms if this marker isn't already visible — clicking through a list
              // of already-visible markers shouldn't yank the photo around on every click.
              centerOn(t.x, t.y, { onlyIfOffscreen: true });
            } else {
              setSelectedTagId(null);
            }
          }}
          onEditTag={(t) => {
            setSelectedTagId(null);
            setDialogInitial(t);
          }}
          displayFields={displayFields}
          open={sidebarOpen}
          onToggleOpen={() => setSidebarOpen((v) => !v)}
          listMode={listMode}
          onListModeChange={(mode) => {
            setListMode(mode);
            setSelectedTagId(null);
          }}
        />
        <div
          ref={containerRef}
          className="relative flex-1 overflow-hidden bg-gray-800"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})` }}
          >
            <canvas
              ref={displayCanvasRef}
              width={canvasSize.width}
              height={canvasSize.height}
              onClick={handleCanvasClick}
              onDoubleClick={handleCanvasDoubleClick}
              className={`block bg-gray-800 ${spacePressed ? "cursor-grab" : "cursor-crosshair"}`}
            />
            <div className="pointer-events-none absolute inset-0">
              {displayFields.has("line") && (
                <svg
                  className="absolute inset-0 h-full w-full"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                >
                  {rowLineSegments.map((seg) => (
                    <line
                      key={seg.key}
                      x1={seg.x1}
                      y1={seg.y1}
                      x2={seg.x2}
                      y2={seg.y2}
                      stroke={seg.color}
                      strokeWidth={0.3}
                      strokeLinecap="round"
                    />
                  ))}
                </svg>
              )}
              {tags.map((t) => {
                const overridden =
                  dragPreview && dragPreview.id === t.id
                    ? { ...t, x: dragPreview.x, y: dragPreview.y }
                    : t;
                const p = previewPoint(overridden);
                const { xFrac, yFrac } = fullResToFraction(
                  p.x,
                  p.y,
                  imageWidth,
                  imageHeight,
                );
                const isProblem = problemIds.has(t.id);
                const isHighlighted = t.id === highlightedTagId;
                const isSelected = t.id === selectedTagId;
                // Same "gray out everyone else" principle as the validate page — but only while
                // browsing via the list (sidebarOpen), so normal click-to-select/drag during regular
                // tagging work doesn't gray out the whole photo on every click.
                const grayed =
                  sidebarOpen &&
                  selectedTagId !== null &&
                  !isSelected &&
                  !isHighlighted;
                const color = grayed ? GRAY_MARKER_COLOR : colorForRow(t.row);
                return (
                  <div
                    key={t.id}
                    className="absolute transition-opacity duration-150"
                    style={{
                      left: `${xFrac * 100}%`,
                      top: `${yFrac * 100}%`,
                      zIndex: isHighlighted || isSelected ? 10 : undefined,
                      opacity: grayed ? 0.6 : 1,
                    }}
                  >
                    <TagMarker
                      color={color}
                      size={isHighlighted ? 20 : isSelected ? 18 : 14}
                      ring={
                        isHighlighted
                          ? "0 0 0 4px #6366f1"
                          : isSelected
                            ? "0 0 0 3px #facc15"
                            : t.reportedProblem
                              ? "0 0 0 2px #f97316"
                              : isProblem
                                ? "0 0 0 2px #ef4444"
                                : undefined
                      }
                      title={
                        t.reportedProblem
                          ? `${t.code} — ${t.name} (บัณฑิตแจ้งปัญหา)`
                          : `${t.code} — ${t.name}`
                      }
                    />
                    <TagLabel
                      order={t.order}
                      code={t.code}
                      name={t.name}
                      color={color}
                      fields={displayFields}
                      angle={labelAngle}
                    />
                  </div>
                );
              })}
              {faceCandidates.map((c) => {
                const { xFrac, yFrac } = fullResToFraction(
                  c.x,
                  c.y,
                  imageWidth,
                  imageHeight,
                );
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

          {!loaded && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="flex items-center gap-3 rounded-lg bg-white px-5 py-4 shadow-xl">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-indigo-600" />
                <span className="text-sm font-medium text-gray-700">
                  กำลังโหลดรูป...
                </span>
              </div>
            </div>
          )}

          {bulkAdjustMode && (
            <div className="absolute right-3 top-3 z-20 w-64 rounded-lg border border-gray-200 bg-white p-3 shadow-xl">
              <p className="mb-2 text-xs font-semibold text-gray-900">
                ปรับตำแหน่งทั้งหมด ({tags.length} คน)
              </p>
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
      </div>

      <div className="flex flex-col gap-2 border-t border-gray-200 bg-white px-3 py-2 text-xs">
        {/* Row 1: the photo/detection controls. */}
        <div className="flex flex-wrap items-center gap-2">
          <ZoomButtons
            onZoomOut={() => zoomBy(1 / ZOOM_STEP)}
            onZoomIn={() => zoomBy(ZOOM_STEP)}
          />

          <div className="mx-1 h-5 w-px bg-gray-200" />

          {reportedCount > 0 && (
            <>
              <div className="flex items-center gap-2">
                <span className="rounded bg-orange-50 px-2 py-0.5 font-medium text-orange-700">
                  {reportedCount} คนแจ้งปัญหา
                </span>
              </div>
              <div className="mx-1 h-5 w-px bg-gray-200" />
            </>
          )}

          <div className="flex items-center gap-2">
            <label
              className="flex items-center gap-1.5 text-gray-600"
              title="อ่านตัวเลขจากป้ายอัตโนมัติตอนเพิ่มคนใหม่/ตรวจจับใบหน้า — ปิดถ้าไม่อยากเสียเวลา/ค่าใช้จ่าย OCR"
            >
              <input
                type="checkbox"
                checked={ocrEnabled}
                onChange={(e) => setOcrEnabled(e.target.checked)}
              />
              OCR
            </label>

            <button
              type="button"
              disabled={!loaded || isDetecting || hasDetected}
              onClick={() => {
                if (!fullBitmapRef.current) return;
                setHasDetected(true);
                runFaceDetection(fullBitmapRef.current);
              }}
              title={
                hasDetected
                  ? "ตรวจจับไปแล้วในรูปนี้ — กดซ้ำจะได้ผลลัพธ์เดิม"
                  : "ช่วยแนะนำตำแหน่งคนที่ยังไม่ได้แท็ก"
              }
              className="rounded-md border border-gray-300 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {isDetecting
                ? "กำลังตรวจจับ..."
                : hasDetected
                  ? "ตรวจจับแล้ว"
                  : "ตรวจจับใบหน้า"}
            </button>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              disabled={tags.length === 0 || bulkAdjustMode}
              onClick={() => setBulkAdjustMode(true)}
              title="เลื่อน/ย่อขยายจุดที่แท็กไว้ทั้งหมดพร้อมกัน — ใช้เมื่ออัปเดตรูปแล้วตำแหน่งเพี้ยน"
              className="rounded-md border border-gray-300 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              ปรับตำแหน่งทุกจุด
            </button>
            <label className="flex items-center gap-1 text-gray-600">
              มุมเอียง
              <input
                type="number"
                value={labelAngle}
                onChange={(e) => setLabelAngle(Number(e.target.value))}
                step={5}
                className="w-14 rounded-md border border-gray-300 px-1.5 py-1"
              />
            </label>
          </div>
        </div>

        {/* Row 2: shortcut hint (left, under the zoom buttons above) + search + display-field
            checkboxes (right) — its own row always, regardless of window width, so it doesn't
            collapse onto row 1 on wide screens. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="hidden text-gray-400 lg:inline">
            คลิก = เลือกจุด, ลาก = ย้ายตำแหน่ง, Space+ลาก = เลื่อนภาพ, Ctrl +/-
            = ซูม, Ctrl+0 = พอดีจอ, Shift+คลิก = เพิ่มคน, ดับเบิลคลิก = แก้ไข
          </span>

          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSearchNext();
                  }
                }}
                placeholder="ค้นหาชื่อ/นามสกุล/รหัส"
                className="w-40 rounded-md border border-gray-300 px-2 py-1.5"
              />
              <button
                type="button"
                onClick={handleSearchNext}
                disabled={searchMatches.length === 0}
                title="ไปยังคนที่พบ (Enter = ถัดไป)"
                className="rounded-md border border-gray-300 px-2.5 py-1.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                ค้นหา
              </button>
              {searchQuery.trim() && (
                <span className="whitespace-nowrap text-gray-400">
                  {searchMatches.length > 0
                    ? `${searchIndex >= 0 ? searchIndex + 1 : 0}/${searchMatches.length}`
                    : "ไม่พบ"}
                </span>
              )}
            </div>

            <TagDisplayFieldPicker
              value={displayFields}
              onChange={setDisplayFields}
            />
          </div>
        </div>
      </div>

      <TagEditDialog
        open={!!dialogInitial}
        initial={dialogInitial}
        ocrLoading={ocrLoading}
        universityId={universityId}
        registrantByCode={registrantByCode}
        referenceByCode={referenceByCode}
        onSave={handleSave}
        onDelete={dialogInitial?.id ? handleDelete : undefined}
        onClose={() => setDialogInitial(null)}
      />
    </div>
  );
}
