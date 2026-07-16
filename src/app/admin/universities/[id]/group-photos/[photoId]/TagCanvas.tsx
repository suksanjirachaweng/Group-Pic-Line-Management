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
  bulkUpdateTagRowOrder,
  moveGroupPhotoTag,
  updateGroupPhotoImage,
  resetGroupPhotoTagHistory,
} from "@/lib/actions/groupPhotos";
import { ocrCardCrop } from "@/lib/actions/ocr";
import { TagMatchSource } from "@/generated/prisma/enums";
import { uploadLargePhoto } from "@/lib/groupPhoto/uploadLargePhoto";
import {
  clientPointToFullRes,
  fullResToFraction,
  extractCrop,
  extractRectCrop,
  pixelDistance,
} from "./coordinateMapping";
import { useBulkCardOcr } from "./useBulkCardOcr";
import { BulkOcrDebugModal } from "./BulkOcrDebugModal";
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

/**
 * Pure version of the row/order suggestion heuristic, taking an explicit tag list instead of
 * closing over component state — needed so a sequential "accept all" batch save can chain each
 * suggestion off a running local list (updated after each save) rather than the component's own
 * `tags` state, which wouldn't have caught up between saves within the same synchronous loop.
 *
 * Always attaching to the nearest tag's row (regardless of how far away it actually is) works
 * fine for adding one person at a time next to an already-dense crowd of real tags, but bulk-OCR
 * candidates can land on a mostly-untagged photo — with no genuinely-nearby existing tag to
 * anchor on, blind nearest-neighbor chains everything onto a single row instead of recognizing a
 * new one. Guards against that by comparing the Y-gap to the nearest tag against that row's own
 * typical X-spacing (a proxy for "one person's width" that scales with the photo's own
 * resolution) — a Y-jump bigger than that isn't the same row.
 */
function suggestRowOrderAgainst(
  list: TagRecord[],
  x: number,
  y: number,
): { row: number; order: number } {
  if (list.length === 0) return { row: 0, order: 0 };
  let nearest = list[0];
  let best = pixelDistance(x, y, nearest.x, nearest.y);
  for (const t of list) {
    const d = pixelDistance(x, y, t.x, t.y);
    if (d < best) {
      best = d;
      nearest = t;
    }
  }

  const sameRow = list
    .filter((t) => t.row === nearest.row)
    .sort((a, b) => a.x - b.x);
  let unit = best;
  if (sameRow.length >= 2) {
    const gaps: number[] = [];
    for (let i = 1; i < sameRow.length; i++)
      gaps.push(sameRow[i].x - sameRow[i - 1].x);
    gaps.sort((a, b) => a - b);
    unit = gaps[Math.floor(gaps.length / 2)];
  }

  const ROW_GAP_FACTOR = 1;
  if (unit > 0 && Math.abs(y - nearest.y) > unit * ROW_GAP_FACTOR) {
    const maxRow = Math.max(...list.map((t) => t.row));
    return { row: maxRow + 1, order: 0 };
  }

  const order = sameRow.filter((t) => t.x < x).length;
  return { row: nearest.row, order };
}

// A row in one of these photos has a gentle side-to-side tilt (camera angle, curved staging) but
// never anything close to vertical — so two points are "the same row" if the line between them is
// shallow (a real Y-jump of more than ~35% of the X distance between them, plus a small constant
// floor for near-vertical short hops, isn't a row tilt, it's a different row).
const ROW_SLOPE_ALPHA = 0.35;
const ROW_SLOPE_BETA = 40;

/**
 * Groups points into physical rows by growing each row left-to-right: a point joins whichever
 * in-progress row it's most nearly level with its rightmost member so far (within the slope
 * tolerance above), rather than whichever single point anywhere is closest in raw distance —
 * plain nearest-point breaks down once a photo has many rows close together, since a point
 * directly above/below in the NEXT row over is very often nearer in raw distance than its own
 * row-mate two people away.
 */
function clusterIntoRows<T extends { x: number; y: number }>(
  points: T[],
): T[][] {
  const byX = [...points].sort((a, b) => a.x - b.x);
  const clusters: T[][] = [];
  for (const p of byX) {
    let bestCluster = -1;
    let bestDy = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      const tail = clusters[i][clusters[i].length - 1];
      const dx = Math.abs(p.x - tail.x);
      const dy = Math.abs(p.y - tail.y);
      if (dy <= ROW_SLOPE_ALPHA * dx + ROW_SLOPE_BETA && dy < bestDy) {
        bestDy = dy;
        bestCluster = i;
      }
    }
    if (bestCluster >= 0) clusters[bestCluster].push(p);
    else clusters.push([p]);
  }
  return clusters;
}

/** Least-squares line y = a + b*x through a set of points — a single point gives a flat (b=0) line
 * through it, since that's the least-committal guess for a row we've only seen one member of. */
function fitLine(points: { x: number; y: number }[]): { a: number; b: number } {
  if (points.length === 1) return { a: points[0].y, b: 0 };
  const meanX = points.reduce((s, p) => s + p.x, 0) / points.length;
  const meanY = points.reduce((s, p) => s + p.y, 0) / points.length;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - meanX) * (p.y - meanY);
    den += (p.x - meanX) ** 2;
  }
  const b = den === 0 ? 0 : num / den;
  return { a: meanY - b * meanX, b };
}

/**
 * Decides which existing row (if any) each of a batch of new points belongs to.
 *
 * Tried clustering every point (existing tags + new candidates) together by raw adjacency first —
 * it works well when the whole batch is dense (most of a row gets read at once, e.g. the very
 * first OCR pass on a blank photo), but falls apart the moment there are gaps: on a
 * mostly-already-tagged photo, bulk OCR mainly turns up scattered stragglers, and one missing
 * point is enough for the adjacency chain to jump into a neighboring row and drag the rest of the
 * chain with it (verified with synthetic tests — accuracy collapsed well below 50% with realistic
 * gaps, even at 90% density).
 *
 * Fixed by leaning on the existing tags directly instead of adjacency: fit a line through each
 * already-tagged row (robust to missing points, unlike a chain — a row's overall trend barely
 * moves when a few members are absent) and match each new point against whichever row's line
 * predicts it best, only accepting a match that's clearly better than the next-best row's guess.
 * Only candidates that don't confidently match any existing row (including everything, on a
 * completely blank photo) fall back to clustering among themselves.
 */
function resolveRowsForNewPoints(
  existingTags: TagRecord[],
  newPoints: { key: string; x: number; y: number }[],
): Map<string, number> {
  const byRow = new Map<number, { x: number; y: number }[]>();
  for (const t of existingTags) {
    if (!byRow.has(t.row)) byRow.set(t.row, []);
    byRow.get(t.row)!.push({ x: t.x, y: t.y });
  }
  const lines = new Map<number, { a: number; b: number }>();
  for (const [row, pts] of byRow) lines.set(row, fitLine(pts));

  const resolved = new Map<string, number>();
  const unmatched: { key: string; x: number; y: number }[] = [];

  for (const p of newPoints) {
    const residuals = [...lines.entries()]
      .map(([row, line]) => ({
        row,
        resid: Math.abs(p.y - (line.a + line.b * p.x)),
      }))
      .sort((a, b) => a.resid - b.resid);
    if (residuals.length === 0) {
      unmatched.push(p);
    } else if (residuals.length === 1) {
      // Only one row tagged on the whole photo so far — no alternative to compare against, so
      // it's the best available guess.
      resolved.set(p.key, residuals[0].row);
    } else if (residuals[0].resid < 0.5 * residuals[1].resid) {
      resolved.set(p.key, residuals[0].row);
    } else {
      unmatched.push(p);
    }
  }

  if (unmatched.length > 0) {
    const clusters = clusterIntoRows(unmatched);
    // Default (no existing tags to infer a direction from): row 0 = sitting front row, which sits
    // LOWER in the frame (larger Y) than the standing rows behind it — confirmed against real
    // sample data, row 0 averaged Y=3387 vs row 8's Y=1419 on an 4870-tall photo. So row number
    // increases going *up* the frame by default, not down.
    let rowsIncreaseDownward = false;
    if (existingTags.length >= 2) {
      const sorted = [...existingTags].sort((a, b) => a.row - b.row);
      rowsIncreaseDownward = sorted[sorted.length - 1].y >= sorted[0].y;
    }
    const maxExistingRow =
      existingTags.length > 0
        ? Math.max(...existingTags.map((t) => t.row))
        : -1;
    const order = clusters
      .map((c, i) => ({ i, avgY: c.reduce((s, p) => s + p.y, 0) / c.length }))
      .sort((a, b) =>
        rowsIncreaseDownward ? a.avgY - b.avgY : b.avgY - a.avgY,
      );
    order.forEach(({ i }, rank) => {
      const row = maxExistingRow + 1 + rank;
      for (const p of clusters[i]) resolved.set(p.key, row);
    });
  }

  return resolved;
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
  const [displayFields, setDisplayFields] = useState<Set<TagDisplayField>>(
    () => new Set<TagDisplayField>(["code", "name", "line"]),
  );
  const [labelAngle, setLabelAngle] = useState(-30);
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
  const [cropMode, setCropMode] = useState(false);
  // Tracked relative to the container's own top-left (not the pan/zoomed canvas — this overlay is
  // a container-relative sibling of it, so it isn't dragged around by that transform while the
  // user is still drawing it) so the overlay's style can be computed directly during render with
  // no ref reads. Converted back to client coordinates — via containerRef, read in the confirm
  // handler rather than render — then through `clientPointToFullRes` once the selection is final.
  const [cropRect, setCropRect] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);
  const cropDragStartRef = useRef<{ x: number; y: number } | null>(null);
  const [cropSaving, setCropSaving] = useState(false);

  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const fullBitmapRef = useRef<ImageBitmap | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    candidates: bulkOcrCandidates,
    isDetecting: isBulkOcrRunning,
    progress: bulkOcrProgress,
    failedTiles: bulkOcrFailedTiles,
    tileDebug: bulkOcrTileDebug,
    detect: runBulkOcr,
    dismiss: dismissBulkOcrCandidate,
  } = useBulkCardOcr();
  const [bulkOcrAccepting, setBulkOcrAccepting] = useState(false);
  const [fixingRowsOrder, setFixingRowsOrder] = useState(false);
  const [showOcrDebug, setShowOcrDebug] = useState(false);

  // Skip suggesting a candidate for someone who already has a tag — bulk OCR re-reads the whole
  // photo from scratch each run, so on a partially-tagged photo most of its hits are already-
  // tagged people, not new ones. Matching by CODE (exact, scale-independent) catches this far more
  // reliably than a position-distance cutoff would: a fixed pixel threshold has to somehow account
  // for OCR's own position noise (which scales with how big the cards are in a given photo, not a
  // constant), whereas the same physical card reads the same digits whether the estimated position
  // drifted 20px or 200px. Distance is kept only as a fallback for the rare case a code was
  // misread differently between the original tagging and this OCR pass.
  const ALREADY_TAGGED_DISTANCE_FALLBACK = 100;
  const newBulkOcrCandidates = useMemo(() => {
    const existingCodes = new Set(tags.map((t) => t.normalizedCode));
    return bulkOcrCandidates.filter((c) => {
      if (existingCodes.has(c.code)) return false;
      return tags.every(
        (t) =>
          pixelDistance(c.x, c.y, t.x, t.y) >= ALREADY_TAGGED_DISTANCE_FALLBACK,
      );
    });
  }, [bulkOcrCandidates, tags]);

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

  function centerOn(x: number, y: number) {
    const canvas = displayCanvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const targetScale = Math.max(scale, SEARCH_ZOOM);
    const displayX = (x / imageWidth) * canvas.width;
    const displayY = (y / imageHeight) * canvas.height;
    const rect = container.getBoundingClientRect();
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

  // Suggests where a new point probably belongs, so adding a missed person doesn't always start
  // from a blank "row 0" guess — both fields stay manually editable in the dialog either way,
  // same as the legacy tool where a human always picked the row themselves.
  // Default row: whichever existing tag is geometrically closest to the click — a new person is
  // almost always tagged right next to who they're standing/sitting beside. Default order: insert
  // left-to-right by X position among that row's existing tags, so a person missed in the middle
  // of an already-tagged row lands between their real neighbors — saving then shifts everyone from
  // that slot onward over by one automatically (server + local state both apply the same shift,
  // see applyRowOrderShift).
  function suggestRowOrder(
    x: number,
    y: number,
  ): { row: number; order: number } {
    return suggestRowOrderAgainst(tags, x, y);
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
    if (draggedRef.current || spacePressed || bulkAdjustMode || cropMode) {
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
    if (bulkAdjustMode || cropMode) return;
    const nearest = findNearestTagWithinThreshold(e.clientX, e.clientY);
    if (!nearest) return;
    setSelectedTagId(null);
    setDialogInitial(nearest);
  }

  // Saves a bulk-OCR candidate straight to a real tag (no dialog) — code and position are already
  // known from the OCR pass, so the only things left to fill in are name/registrant match (same
  // code lookup TagEditDialog does when typing a code) and order within its (already-decided —
  // see resolveRowsForNewPoints) row. Takes an explicit tag list rather than reading `tags`
  // directly so a sequential batch save (see handleAcceptAllBulkOcrCandidates) computes each
  // order off its own running list instead of possibly-stale component state.
  async function saveBulkOcrCandidate(
    against: TagRecord[],
    candidate: { code: string; x: number; y: number },
    row: number,
  ): Promise<TagRecord> {
    const normalizedCode = candidate.code.replace(/\D+/g, "");
    const reg = registrantByCode.get(normalizedCode);
    const ref = !reg ? referenceByCode.get(normalizedCode) : undefined;
    const name = reg ? reg.name : ref ? ref.name : "";
    const registrantId = reg ? reg.id : null;
    const matchSource = reg
      ? TagMatchSource.REGISTRANT
      : ref
        ? TagMatchSource.LEGACY_REFERENCE
        : TagMatchSource.MANUAL;
    const order = against.filter(
      (t) => t.row === row && t.x < candidate.x,
    ).length;

    const result = await saveGroupPhotoTag(universityId, groupPhotoId, {
      id: undefined,
      code: candidate.code,
      name,
      row,
      order,
      x: candidate.x,
      y: candidate.y,
      registrantId,
      matchSource,
    });

    return {
      id: result.id,
      code: candidate.code,
      normalizedCode,
      name,
      row,
      order,
      x: candidate.x,
      y: candidate.y,
      registrantId,
      matchSource,
      reportedProblem: false,
    };
  }

  async function handleQuickSaveBulkOcrCandidate(
    candidateId: string,
    x: number,
    y: number,
    code: string,
  ) {
    dismissBulkOcrCandidate(candidateId);
    const row = resolveRowsForNewPoints(tags, [{ key: candidateId, x, y }]).get(
      candidateId,
    )!;
    const saved = await saveBulkOcrCandidate(tags, { code, x, y }, row);
    setTags((prev) => [
      ...applyRowOrderShift(prev, undefined, saved.row, saved.order),
      saved,
    ]);
  }

  async function handleAcceptAllBulkOcrCandidates() {
    const toSave = newBulkOcrCandidates;
    if (toSave.length === 0) return;
    setBulkOcrAccepting(true);
    try {
      // A bulk-OCR run redefines a big chunk of the photo's tagging state at once — the prior
      // per-tag edit history no longer reads as a meaningful audit trail against that new
      // baseline, so it's cleared rather than kept alongside it.
      await resetGroupPhotoTagHistory(universityId, groupPhotoId);
      // Rows for the whole batch are decided together upfront (clustering candidates against
      // each other, not just against what's already tagged) — only the per-row insertion order
      // has to be computed one at a time as `running` grows, since two candidates landing in the
      // same new row need consecutive orders, not both guessing order 0.
      const rows = resolveRowsForNewPoints(
        tags,
        toSave.map((c) => ({ key: c.id, x: c.x, y: c.y })),
      );
      let running = tags;
      for (const candidate of toSave) {
        dismissBulkOcrCandidate(candidate.id);
        try {
          const row = rows.get(candidate.id)!;
          const saved = await saveBulkOcrCandidate(running, candidate, row);
          running = [
            ...applyRowOrderShift(running, undefined, saved.row, saved.order),
            saved,
          ];
          setTags(running);
        } catch (err) {
          console.error("Failed to save a bulk OCR candidate:", err);
        }
      }
    } finally {
      setBulkOcrAccepting(false);
    }
  }

  // Re-clusters every already-saved tag on this photo into rows from scratch (see
  // clusterIntoRows) and overwrites row/order to match — for fixing a photo whose row/order
  // assignments came out wrong (e.g. tags saved before the row-clustering fix, or tags imported
  // from elsewhere with no row/order at all), without re-running OCR at all since every tag's
  // code and position are already correct and untouched.
  async function handleFixAllRowsAndOrder() {
    if (tags.length === 0) return;
    if (
      !window.confirm(
        `จัดเรียงแถวและลำดับใหม่ทั้งหมดจากตำแหน่งจุดที่มีอยู่ (${tags.length} คน) โดยไม่แตะรหัส/ชื่อ/ตำแหน่งจุดเลย ต้องการดำเนินการต่อหรือไม่?`,
      )
    ) {
      return;
    }
    setFixingRowsOrder(true);
    try {
      // Row 0 = sitting front row, which sits LOWER in the frame (larger Y) than the standing
      // rows behind it — same convention confirmed against real sample data in
      // resolveRowsForNewPoints. There's nothing else to infer a direction from here, since this
      // recomputes every tag's row at once rather than adding a few new ones to what's already
      // correctly numbered.
      const clusters = clusterIntoRows(tags);
      const ordered = [...clusters].sort(
        (a, b) =>
          b.reduce((s, t) => s + t.y, 0) / b.length -
          a.reduce((s, t) => s + t.y, 0) / a.length,
      );

      const updates: { id: string; row: number; order: number }[] = [];
      const byId = new Map<string, TagRecord>();
      ordered.forEach((cluster, row) => {
        const sorted = [...cluster].sort((a, b) => a.x - b.x);
        sorted.forEach((tag, order) => {
          byId.set(tag.id, { ...tag, row, order });
          if (tag.row !== row || tag.order !== order) {
            updates.push({ id: tag.id, row, order });
          }
        });
      });

      if (updates.length > 0) {
        // Same reasoning as the bulk-OCR accept-all path: re-clustering every tag's row/order at
        // once redefines the photo's layout wholesale, so the prior edit history no longer reads
        // as a meaningful audit trail against it.
        // await resetGroupPhotoTagHistory(universityId, groupPhotoId);
        await bulkUpdateTagRowOrder(universityId, groupPhotoId, updates);
        setTags((prev) => prev.map((t) => byId.get(t.id) ?? t));
      }
      window.alert(
        updates.length > 0
          ? `จัดเรียงใหม่แล้ว ${updates.length} คน เป็น ${ordered.length} แถว`
          : "แถวและลำดับที่มีอยู่ถูกต้องอยู่แล้ว ไม่มีอะไรต้องแก้",
      );
    } catch (err) {
      console.error("Failed to fix row/order:", err);
      window.alert("จัดเรียงแถวและลำดับไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setFixingRowsOrder(false);
    }
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
    // Space+drag still pans even while cropMode is on, so the target area can be navigated into
    // view before drawing the selection — checked first, same priority it already has over
    // normal tag dragging below.
    if (spacePressed || e.button === 1) {
      draggingRef.current = { x: e.clientX - tx, y: e.clientY - ty };
      return;
    }
    if (cropMode) {
      if (e.button !== 0) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      cropDragStartRef.current = { x, y };
      setCropRect({ x1: x, y1: y, x2: x, y2: y });
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
    if (cropMode) {
      if (!cropDragStartRef.current) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setCropRect({
        x1: cropDragStartRef.current.x,
        y1: cropDragStartRef.current.y,
        x2: e.clientX - rect.left,
        y2: e.clientY - rect.top,
      });
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
    // A space-pan gesture always takes priority, even mid-cropMode (see handleMouseDown) — clear
    // it here regardless of cropMode, same as before crop mode existed.
    if (draggingRef.current) {
      draggingRef.current = null;
      return;
    }
    if (cropMode) {
      // Leave cropRect as-is — the floating panel's confirm/cancel buttons act on it next,
      // rather than clearing it here the way a normal tag-drag gesture resolves immediately.
      cropDragStartRef.current = null;
      return;
    }
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

  function exitCropMode() {
    setCropMode(false);
    setCropRect(null);
    cropDragStartRef.current = null;
  }

  async function handleCropConfirm() {
    const canvas = displayCanvasRef.current;
    const bitmap = fullBitmapRef.current;
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!cropRect || !canvas || !bitmap || !containerRect) return;

    const p1 = clientPointToFullRes(
      containerRect.left + cropRect.x1,
      containerRect.top + cropRect.y1,
      canvas,
      imageWidth,
      imageHeight,
    );
    const p2 = clientPointToFullRes(
      containerRect.left + cropRect.x2,
      containerRect.top + cropRect.y2,
      canvas,
      imageWidth,
      imageHeight,
    );
    const sx = Math.max(0, Math.min(p1.x, p2.x));
    const sy = Math.max(0, Math.min(p1.y, p2.y));
    const sw = Math.min(imageWidth - sx, Math.abs(p2.x - p1.x));
    const sh = Math.min(imageHeight - sy, Math.abs(p2.y - p1.y));
    if (sw < 20 || sh < 20) {
      window.alert("พื้นที่ที่เลือกเล็กเกินไป กรุณาลากเลือกใหม่");
      return;
    }
    if (
      !window.confirm(
        'ครอบตัดรูปแล้ว ต้องการบันทึกอัปเดตรูปภาพเลยหรือไม่? แท็กที่มีอยู่จะยังอยู่เหมือนเดิม แต่ตำแหน่งอาจเพี้ยนถ้าพื้นที่ที่ครอบตัดตัดคนที่แท็กไว้ออกไป (ปรับได้ทีหลังด้วยปุ่ม "ปรับตำแหน่งทุกจุด")',
      )
    ) {
      return;
    }

    setCropSaving(true);
    try {
      const blob = await extractRectCrop(bitmap, sx, sy, sw, sh);
      const file = new File([blob], "cropped.jpg", { type: "image/jpeg" });
      const { url } = await uploadLargePhoto(universityId, file);
      await updateGroupPhotoImage(universityId, groupPhotoId, {
        imageUrl: url,
        imageWidth: Math.round(sw),
        imageHeight: Math.round(sh),
      });
      // A full reload, not router.refresh() — confirmed router.refresh() alone doesn't get the
      // already-mounted canvas to actually redraw the new image (new props arrive, but nothing
      // visibly updates until the next real navigation), even though the underlying [imageUrl]
      // effect looks like it should re-run. A reload guarantees the new image is what loads.
      window.location.reload();
    } catch (err) {
      window.alert(
        `บันทึกรูปที่ครอบตัดไม่สำเร็จ: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    } finally {
      setCropSaving(false);
      exitCropMode();
    }
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
              centerOn(t.x, t.y);
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
              {newBulkOcrCandidates.map((c) => {
                const { xFrac, yFrac } = fullResToFraction(
                  c.x,
                  c.y,
                  imageWidth,
                  imageHeight,
                );
                return (
                  <div
                    key={c.id}
                    className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${xFrac * 100}%`, top: `${yFrac * 100}%` }}
                  >
                    <button
                      type="button"
                      className="rounded-full border-2 border-dashed border-emerald-400 bg-emerald-400/10 hover:bg-emerald-400/30"
                      style={{ width: 16, height: 16 }}
                      onClick={() =>
                        void handleQuickSaveBulkOcrCandidate(
                          c.id,
                          c.x,
                          c.y,
                          c.code,
                        )
                      }
                      title="อ่านได้จากป้ายอัตโนมัติ — คลิกเพื่อบันทึกคนนี้ทันที"
                    />
                    <div className="pointer-events-none absolute left-1/2 top-full mt-0.5 -translate-x-1/2 whitespace-nowrap rounded bg-emerald-700/80 px-1 text-[10px] leading-tight text-white">
                      {c.code}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Selection rectangle — a container-relative sibling of the pan/zoomed inner div (not
              inside it), tracked in container-relative coordinates already (see `cropRect`), so
              it stays exactly where the mouse is dragging regardless of the current zoom/pan
              transform, with no ref reads needed here during render. */}
          {cropMode && cropRect && (
            <div
              className="pointer-events-none absolute z-20 border-2 border-dashed border-yellow-400 bg-yellow-400/10"
              style={{
                left: Math.min(cropRect.x1, cropRect.x2),
                top: Math.min(cropRect.y1, cropRect.y2),
                width: Math.abs(cropRect.x2 - cropRect.x1),
                height: Math.abs(cropRect.y2 - cropRect.y1),
              }}
            />
          )}

          {cropMode && (
            <div
              className="absolute right-3 top-3 z-20 w-64 rounded-lg border border-gray-200 bg-white p-3 shadow-xl"
              // This panel sits inside the same container that has onMouseDown={handleMouseDown}
              // for drawing the selection — without stopping propagation here, clicking either
              // button first bubbles a mousedown into that handler, which (still in cropMode)
              // resets cropRect to a zero-size rect at the button's own position, so
              // handleCropConfirm's onClick then reads a corrupted, always-too-small selection
              // instead of the one just drawn.
              onMouseDown={(e) => e.stopPropagation()}
            >
              <p className="mb-2 text-xs font-semibold text-gray-900">
                ครอบตัดรูปภาพ
              </p>
              <p className="mb-3 text-xs text-gray-500">
                ลากบนรูปเพื่อเลือกพื้นที่ที่ต้องการครอบตัด
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={exitCropMode}
                  disabled={cropSaving}
                  className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={handleCropConfirm}
                  disabled={cropSaving || !cropRect}
                  className="flex-1 rounded-md bg-indigo-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {cropSaving ? "กำลังบันทึก..." : "ยืนยันครอบตัด"}
                </button>
              </div>
            </div>
          )}

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

          <div className="flex items-center gap-2 rounded-md border border-gray-300 px-2 py-1">
            <label
              className="flex items-center gap-1.5 text-gray-600"
              title="อ่านตัวเลขจากป้ายอัตโนมัติตอนเพิ่มคนใหม่ — ปิดถ้าไม่อยากเสียเวลา/ค่าใช้จ่าย OCR"
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
              disabled={!loaded || isBulkOcrRunning}
              onClick={() => {
                if (!fullBitmapRef.current) return;
                void runBulkOcr(fullBitmapRef.current, universityId);
              }}
              title="อ่านตัวเลขบนป้ายทั้งภาพโดยตรง — ตำแหน่งที่ได้เป็นค่าประมาณ ควรตรวจสอบก่อนบันทึกจริง"
              className="rounded-md border border-gray-300 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {isBulkOcrRunning
                ? `กำลังอ่านป้าย... ${bulkOcrProgress.done}/${bulkOcrProgress.total}`
                : "อ่านป้ายอัตโนมัติ"}
            </button>

            {!isBulkOcrRunning && bulkOcrFailedTiles > 0 && (
              <span
                className="rounded bg-amber-50 px-2 py-0.5 text-amber-700"
                title="บาง tile เรียก OCR ไม่สำเร็จ (เช่น โดน rate limit ชั่วคราว) — ผลลัพธ์ที่ได้อาจน้อยกว่าที่ควร ลองกด 'อ่านป้ายอัตโนมัติ' ซ้ำได้"
              >
                {bulkOcrFailedTiles} tile ล้มเหลว
              </span>
            )}

            {!isBulkOcrRunning && bulkOcrTileDebug.length > 0 && (
              <button
                type="button"
                onClick={() => setShowOcrDebug(true)}
                title="ดูภาพและตำแหน่งที่ OCR อ่านได้ของแต่ละ tile ทีละใบ เพื่อตรวจสอบว่าจุดไหนอ่านผิด/ตำแหน่งเพี้ยนมาจาก tile ไหน"
                className="rounded-md border border-gray-300 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50"
              >
                ตรวจสอบผล OCR ({bulkOcrTileDebug.length} tile)
              </button>
            )}

            {newBulkOcrCandidates.length > 0 && (
              <button
                type="button"
                disabled={bulkOcrAccepting || isBulkOcrRunning}
                onClick={() => void handleAcceptAllBulkOcrCandidates()}
                title="บันทึกทุกจุดที่อ่านป้ายได้เป็นแท็กจริงทันที (แถว/ลำดับ เดาให้อัตโนมัติจากตำแหน่งใกล้เคียง — แก้ทีหลังได้)"
                className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
              >
                {bulkOcrAccepting
                  ? "กำลังบันทึก..."
                  : `ยืนยันทั้งหมด (${newBulkOcrCandidates.length})`}
              </button>
            )}

            <button
              type="button"
              disabled={tags.length === 0 || fixingRowsOrder}
              onClick={() => void handleFixAllRowsAndOrder()}
              title="จัดเรียงแถวและลำดับของทุกคนที่แท็กไว้แล้วใหม่ จากตำแหน่งจุดที่มีอยู่ ไม่เรียก OCR ซ้ำ ไม่แตะรหัส/ชื่อ/ตำแหน่งจุด"
              className="rounded-md border border-gray-300 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {fixingRowsOrder ? "กำลังจัดเรียง..." : "แก้แถวและลำดับ"}
            </button>

            <button
              type="button"
              disabled={!loaded || bulkAdjustMode}
              onClick={() => {
                setSelectedTagId(null);
                setDialogInitial(null);
                setCropMode(true);
              }}
              title="เลือกพื้นที่บนรูปเพื่อครอบตัดแล้วบันทึกแทนที่รูปเดิม"
              className={`rounded-md border px-3 py-1.5 font-medium disabled:opacity-50 ${
                cropMode
                  ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                  : "border-gray-300 text-gray-700 hover:bg-gray-50"
              }`}
            >
              ครอบตัดรูป
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

      {showOcrDebug && (
        <BulkOcrDebugModal tiles={bulkOcrTileDebug} onClose={() => setShowOcrDebug(false)} />
      )}
    </div>
  );
}
