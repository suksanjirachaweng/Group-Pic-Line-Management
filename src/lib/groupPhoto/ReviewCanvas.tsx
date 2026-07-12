"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { TagLabel, TagMarker, type TagDisplayField } from "./TagLabel";
import { colorForRow } from "./rowColor";

const DISPLAY_MAX_WIDTH = 3500;
const MIN_SCALE = 0.05;
const MAX_SCALE = 6;
const ZOOM_STEP = 1.25;
const REVIEW_ZOOM = 1.2;
const POPUP_WIDTH = 260;
const POPUP_HEIGHT = 200;
const UNSELECTED_MARKER_SIZE = 9;
const GRAY_MARKER_COLOR = "#9ca3af";

const DEFAULT_DISPLAY_FIELDS = new Set<TagDisplayField>(["code", "line"]);

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return (
    el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable
  );
}

export type ReviewTag = {
  id: string;
  code: string;
  name: string;
  row: number;
  order: number;
  x: number;
  y: number;
  isProblem: boolean;
};

/** Imperative zoom controls for callers that render their own zoom buttons outside this
 * component (e.g. a consolidated toolbar) instead of using the built-in one. */
export type ReviewCanvasHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
};

/**
 * Read-mostly view of a tagged group photo — pan/zoom + marks/labels like the main tagging
 * canvas, but no face-detection and no click-to-add-new-person (reviewing an existing tag isn't
 * the same action as tagging a new one). Clicking an editable mark opens a small inline popup
 * right there instead of a full-page dialog. Shared by the internal /validate page and the
 * public /photo-review/[token] page — the caller supplies `onSave` so this component never needs
 * to know which server action (session vs. token authenticated) actually persists the edit.
 */
export const ReviewCanvas = forwardRef<ReviewCanvasHandle, {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  tags: ReviewTag[];
  /** Omit to make every tag editable (the admin validate view); pass a set to restrict (the public share view). */
  editableTagIds?: Set<string>;
  selectedTagId: string | null;
  onSelectTag: (id: string | null) => void;
  onSave?: (
    tagId: string,
    input: { code: string; name: string },
  ) => Promise<{ error?: string } | void>;
  /** Which fields to render on each marker's label + whether to draw the row-order connecting
   * lines. Defaults to the original fixed look (code label + lines) for callers that don't
   * expose a display picker. */
  displayFields?: Set<TagDisplayField>;
  /** Pure viewing — nothing is clickable and the edit popup never appears (e.g. a registrant
   * looking up their own tagged position). `selectedTagId` still drives centering/highlighting. */
  readOnly?: boolean;
  /** Opt-in double-click hook, independent of `editable`/`readOnly` — lets a caller open its own
   * full dialog (e.g. the public /validate page) rather than the small inline popup below, even
   * when single-click editing is otherwise disabled. Selects + centers the tag first. */
  onDoubleClickTag?: (tag: ReviewTag) => void;
  /** When set, only this one tag gets a text label — every other tag renders as a bare unlabeled
   * pin. For a graduate's personal /photo-view link, where everyone else's name/code isn't this
   * viewer's to see, just their own. */
  soloLabelTagId?: string | null;
  /** When set, tapping/clicking anywhere on the photo reports that point as this tag's new
   * position via `onPlaceTag` instead of the normal deselect-on-click behavior — a graduate
   * fixing their own mis-placed mark by tapping where they actually are, rather than a drag
   * gesture (which would fight the existing single-finger-pan/pinch-zoom touch handling below). */
  placementTagId?: string | null;
  onPlaceTag?: (tagId: string, x: number, y: number) => void;
  /** Grays out every marker/label except the selected one, instead of each row's own color — for
   * the public /validate page, where dozens of row colors at once read as noisy clutter but the
   * text still needs to stay legible. Off by default so photo-view/photo-review keep their
   * per-row coloring. */
  grayUnselected?: boolean;
  /** Hides the top zoom-button/hint-text bar entirely — for the graduate's personal /photo-view
   * link, which is only ever opened from a LINE mobile link where pinch-zoom/drag-to-pan are
   * already the natural gestures; the row was pure clutter with nothing left to explain. */
  hideToolbar?: boolean;
}>(function ReviewCanvas(
  {
    imageUrl,
    imageWidth,
    imageHeight,
    tags,
    editableTagIds,
    selectedTagId,
    onSelectTag,
    onSave,
    onDoubleClickTag,
    displayFields = DEFAULT_DISPLAY_FIELDS,
    readOnly = false,
    soloLabelTagId,
    placementTagId,
    onPlaceTag,
    grayUnselected = false,
    hideToolbar = false,
  },
  ref,
) {
  const [loaded, setLoaded] = useState(false);
  const [scale, setScale] = useState(0.25);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [spacePressed, setSpacePressed] = useState(false);
  const [editCode, setEditCode] = useState("");
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [containerSize, setContainerSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry)
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
      full.close();
      setCanvasSize({ width: targetW, height: targetH });
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  // Anchors the zoom at the viewport's current center (in screen space) instead of the content's
  // top-left transform-origin, so the point you were looking at stays put instead of the view
  // drifting toward the corner on every zoom step — same anchor math as the pinch-zoom handler
  // below, just centered on the container instead of the pinch midpoint.
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

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => zoomBy(ZOOM_STEP),
      zoomOut: () => zoomBy(1 / ZOOM_STEP),
    }),
    [],
  );

  // Reads `canvasSize` state (not the canvas ref) so this is safe to call during render, e.g. to
  // position the edit popup.
  function toScreenPx(x: number, y: number): { left: number; top: number } {
    if (!canvasSize) return { left: 0, top: 0 };
    const displayX = (x / imageWidth) * canvasSize.width;
    const displayY = (y / imageHeight) * canvasSize.height;
    return { left: tx + displayX * scale, top: ty + displayY * scale };
  }

  function centerOn(x: number, y: number) {
    const container = containerRef.current;
    if (!canvasSize || !container) return;
    const targetScale = Math.max(scale, REVIEW_ZOOM);
    const displayX = (x / imageWidth) * canvasSize.width;
    const displayY = (y / imageHeight) * canvasSize.height;
    const rect = container.getBoundingClientRect();
    setScale(targetScale);
    setTx(rect.width / 2 - displayX * targetScale);
    setTy(rect.height / 2 - displayY * targetScale);
  }

  const selectedTag = useMemo(
    () => tags.find((t) => t.id === selectedTagId) ?? null,
    [tags, selectedTagId],
  );

  // Reset the edit fields whenever the selection changes — derived during render (not an effect)
  // per React's "you might not need an effect" guidance, same pattern as TagEditDialog.
  const [syncedTagId, setSyncedTagId] = useState<string | null>(null);
  if ((selectedTag?.id ?? null) !== syncedTagId) {
    setSyncedTagId(selectedTag?.id ?? null);
    if (selectedTag) {
      setEditCode(selectedTag.code);
      setEditName(selectedTag.name);
      setSaveError(null);
    }
  }

  useEffect(() => {
    if (!selectedTag || !loaded) return;
    centerOn(selectedTag.x, selectedTag.y);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-center when the selection itself changes, not on every pan/zoom
  }, [selectedTag?.id, loaded]);

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

  // Touch equivalent of the mouse handlers above — no Spacebar on mobile, so a single-finger
  // drag pans directly; a second finger switches to pinch-zoom, anchored at the pinch midpoint
  // so the point under your fingers stays put. `touch-none` on the container (below) hands all
  // gesture handling to us — otherwise the browser's own pinch-zoom/scroll would fight this.
  const touchPanRef = useRef<{ x: number; y: number } | null>(null);
  const pinchRef = useRef<{
    startDist: number;
    startScale: number;
    startTx: number;
    startTy: number;
    midX: number;
    midY: number;
  } | null>(null);

  function touchDistance(a: React.Touch, b: React.Touch): number {
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  function handleTouchStart(e: ReactTouchEvent) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      pinchRef.current = {
        startDist: touchDistance(a, b),
        startScale: scale,
        startTx: tx,
        startTy: ty,
        midX: (a.clientX + b.clientX) / 2 - (rect?.left ?? 0),
        midY: (a.clientY + b.clientY) / 2 - (rect?.top ?? 0),
      };
      touchPanRef.current = null;
    } else if (e.touches.length === 1) {
      const t = e.touches[0];
      touchPanRef.current = { x: t.clientX - tx, y: t.clientY - ty };
      pinchRef.current = null;
    }
  }
  function handleTouchMove(e: ReactTouchEvent) {
    if (pinchRef.current && e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const { startDist, startScale, startTx, startTy, midX, midY } = pinchRef.current;
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, startScale * (touchDistance(a, b) / startDist)));
      const ratio = newScale / startScale;
      draggedRef.current = true;
      setScale(newScale);
      setTx(midX - (midX - startTx) * ratio);
      setTy(midY - (midY - startTy) * ratio);
    } else if (touchPanRef.current && e.touches.length === 1) {
      const t = e.touches[0];
      draggedRef.current = true;
      setTx(t.clientX - touchPanRef.current.x);
      setTy(t.clientY - touchPanRef.current.y);
    }
  }
  function handleTouchEnd(e: ReactTouchEvent) {
    if (e.touches.length === 0) {
      touchPanRef.current = null;
      pinchRef.current = null;
    } else if (e.touches.length === 1) {
      // Lifted one finger out of a pinch — resume panning from the remaining finger instead of
      // jumping (recompute the anchor from its current position, not the pinch's last midpoint).
      const t = e.touches[0];
      touchPanRef.current = { x: t.clientX - tx, y: t.clientY - ty };
      pinchRef.current = null;
    }
  }

  function handleCanvasClick(e: ReactMouseEvent<HTMLCanvasElement>) {
    if (draggedRef.current || spacePressed) {
      draggedRef.current = false;
      return;
    }
    if (placementTagId && onPlaceTag) {
      const canvas = displayCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * imageWidth;
      const y = ((e.clientY - rect.top) / rect.height) * imageHeight;
      onPlaceTag(placementTagId, x, y);
      return;
    }
    onSelectTag(null);
  }

  const rowLineSegments = useMemo(() => {
    const byRow = new Map<number, ReviewTag[]>();
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
        segments.push({
          key: `${sorted[i].id}-${sorted[i + 1].id}`,
          x1: (sorted[i].x / imageWidth) * 100,
          y1: (sorted[i].y / imageHeight) * 100,
          x2: (sorted[i + 1].x / imageWidth) * 100,
          y2: (sorted[i + 1].y / imageHeight) * 100,
          color,
        });
      }
    }
    return segments;
  }, [tags, imageWidth, imageHeight]);

  async function handleSaveClick() {
    if (!selectedTag || !onSave) return;
    setSaving(true);
    setSaveError(null);
    const result = await onSave(selectedTag.id, {
      code: editCode,
      name: editName,
    });
    setSaving(false);
    if (result && "error" in result && result.error) {
      setSaveError(result.error);
      return;
    }
    onSelectTag(null);
  }

  const rawPopupPos = selectedTag
    ? toScreenPx(selectedTag.x, selectedTag.y)
    : null;
  const popupPos =
    rawPopupPos && containerSize
      ? {
          left: Math.min(
            Math.max(rawPopupPos.left + 16, 8),
            containerSize.width - POPUP_WIDTH - 8,
          ),
          top: Math.min(
            Math.max(rawPopupPos.top - 16, 8),
            containerSize.height - POPUP_HEIGHT - 8,
          ),
        }
      : rawPopupPos;

  return (
    <div className="flex h-full flex-col">
      {!hideToolbar && (
        <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-3 py-2 text-xs">
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
          <span className="hidden text-gray-400 sm:inline">
            Ctrl +/- = ซูม, Spacebar+ลาก = เลื่อนภาพ
            {!readOnly && ", คลิกจุด = แก้ไข"}
            {onDoubleClickTag && ", ดับเบิลคลิกจุด = แก้ไข"}
          </span>
          <span className="text-gray-400 sm:hidden">
            ลากด้วยนิ้ว = เลื่อนภาพ, สองนิ้วบีบ/ขยาย = ซูม
            {onDoubleClickTag && ", แตะจุด 2 ครั้ง = แก้ไข"}
          </span>
        </div>
      )}

      <div
        ref={containerRef}
        className="relative flex-1 touch-none overflow-hidden bg-gray-800"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})` }}
        >
          <canvas
            ref={displayCanvasRef}
            onClick={handleCanvasClick}
            onContextMenu={(e) => e.preventDefault()}
            onDragStart={(e) => e.preventDefault()}
            className={`block select-none ${spacePressed ? "cursor-grab" : "cursor-default"}`}
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
              const xFrac = t.x / imageWidth;
              const yFrac = t.y / imageHeight;
              const editable = !readOnly && (!editableTagIds || editableTagIds.has(t.id));
              const isSelected = t.id === selectedTagId;
              const isDimmed = selectedTagId !== null && !isSelected;
              const interactive = editable || !!onDoubleClickTag;
              const isSolo = soloLabelTagId != null && t.id === soloLabelTagId;
              const hideLabel = soloLabelTagId != null && !isSolo;
              const grayed = hideLabel || (grayUnselected && !isSelected);
              const color = grayed ? GRAY_MARKER_COLOR : colorForRow(t.row);
              return (
                <div
                  key={t.id}
                  className={`absolute transition-opacity duration-150 ${interactive ? "pointer-events-auto cursor-pointer" : ""} ${isDimmed ? "opacity-60" : "opacity-100"}`}
                  style={{ left: `${xFrac * 100}%`, top: `${yFrac * 100}%` }}
                  onClick={
                    interactive
                      ? (e) => {
                          e.stopPropagation();
                          onSelectTag(t.id);
                        }
                      : undefined
                  }
                  onDoubleClick={
                    onDoubleClickTag
                      ? (e) => {
                          e.stopPropagation();
                          onSelectTag(t.id);
                          onDoubleClickTag(t);
                        }
                      : undefined
                  }
                >
                  <TagMarker
                    color={color}
                    size={isSolo ? 22 : isSelected ? 20 : UNSELECTED_MARKER_SIZE}
                    pulse={isSelected || isSolo}
                    ring={isSolo ? "0 0 0 3px #facc15" : isSelected ? "0 0 0 3px #facc15" : t.isProblem ? "0 0 0 2px #ef4444" : undefined}
                    title={hideLabel ? undefined : `${t.code} — ${t.name}`}
                  />
                  {!hideLabel && (
                    <TagLabel order={t.order} code={t.code} name={t.name} color={color} fields={displayFields} angle={-30} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {!readOnly && selectedTag && popupPos && (
          <div
            className="absolute z-10 w-64 rounded-lg border border-gray-200 bg-white p-3 shadow-xl"
            style={{ left: popupPos.left, top: popupPos.top }}
            onClick={(e) => e.stopPropagation()}
          >
            <label className="block text-xs font-medium text-gray-700">
              รหัส
            </label>
            <input
              value={editCode}
              onChange={(e) => setEditCode(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              autoFocus
            />
            <label className="mt-2 block text-xs font-medium text-gray-700">
              ชื่อ-นามสกุล
            </label>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="เว้นว่างไว้ก่อนได้"
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
            {saveError && (
              <p className="mt-1 text-xs text-red-600">{saveError}</p>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => onSelectTag(null)}
                className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleSaveClick}
                disabled={saving || !editCode.trim()}
                className="rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? "กำลังบันทึก..." : "บันทึก"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
