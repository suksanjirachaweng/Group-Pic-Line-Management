// Cycled by row index so every tag in the same row renders the same color, distinguishing rows
// at a glance (front-sitting row vs. each standing row behind it). Shared by the tagging canvas,
// the review canvas, and the public validate page's row list so the colors always match.
export const ROW_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7", "#06b6d4", "#f97316", "#ec4899"];

export function colorForRow(row: number): string {
  const idx = ((row % ROW_COLORS.length) + ROW_COLORS.length) % ROW_COLORS.length;
  return ROW_COLORS[idx];
}
