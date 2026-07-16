/**
 * Pure row/order clustering logic shared between the desktop tagging canvas (`TagCanvas.tsx`,
 * client-side) and the background auto-tag cron job (server-side, no browser) — extracted so the
 * automated pipeline clusters rows *identically* to a human clicking the same buttons, rather than
 * a separately-maintained reimplementation that could quietly drift from the interactive behavior.
 */

/** Minimal shape these functions need — callers pass their own richer record type (e.g. TagRecord
 * on the client, a plain DB row shape on the server) and get the same type back. */
export type RowClusterable = { id: string; x: number; y: number; row: number; order: number };

export function pixelDistance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/**
 * Mirrors saveGroupPhotoTag's row/order "insert, don't collide" shift locally so an in-memory tag
 * list matches the DB immediately after a save, without a refetch. Must stay in lockstep with that
 * server action's logic — see its comment for why each branch shifts the way it does.
 */
export function applyRowOrderShift<T extends RowClusterable>(
  prevTags: T[],
  savedId: string | undefined,
  targetRow: number,
  targetOrder: number,
): T[] {
  const existing = savedId ? prevTags.find((t) => t.id === savedId) : undefined;
  if (!existing) {
    return prevTags.map((t) =>
      t.row === targetRow && t.order >= targetOrder ? { ...t, order: t.order + 1 } : t,
    );
  }
  if (existing.row === targetRow) {
    if (targetOrder > existing.order) {
      return prevTags.map((t) =>
        t.id !== savedId && t.row === targetRow && t.order > existing.order && t.order <= targetOrder
          ? { ...t, order: t.order - 1 }
          : t,
      );
    }
    if (targetOrder < existing.order) {
      return prevTags.map((t) =>
        t.id !== savedId && t.row === targetRow && t.order >= targetOrder && t.order < existing.order
          ? { ...t, order: t.order + 1 }
          : t,
      );
    }
    return prevTags;
  }
  return prevTags.map((t) => {
    if (t.id === savedId) return t;
    if (t.row === existing.row && t.order > existing.order) return { ...t, order: t.order - 1 };
    if (t.row === targetRow && t.order >= targetOrder) return { ...t, order: t.order + 1 };
    return t;
  });
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
export function clusterIntoRows<T extends { x: number; y: number }>(points: T[]): T[][] {
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
export function fitLine(points: { x: number; y: number }[]): { a: number; b: number } {
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
export function resolveRowsForNewPoints<T extends RowClusterable>(
  existingTags: T[],
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
    const maxExistingRow = existingTags.length > 0 ? Math.max(...existingTags.map((t) => t.row)) : -1;
    const order = clusters
      .map((c, i) => ({ i, avgY: c.reduce((s, p) => s + p.y, 0) / c.length }))
      .sort((a, b) => (rowsIncreaseDownward ? a.avgY - b.avgY : b.avgY - a.avgY));
    order.forEach(({ i }, rank) => {
      const row = maxExistingRow + 1 + rank;
      for (const p of clusters[i]) resolved.set(p.key, row);
    });
  }

  return resolved;
}
