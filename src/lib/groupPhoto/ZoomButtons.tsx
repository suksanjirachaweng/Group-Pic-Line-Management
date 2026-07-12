/** Magnifying-glass zoom icon — a plain "+"/"−" glyph reads as generic text at a glance; the
 * lens+handle shape is immediately recognizable as zoom regardless of the sign inside it. */
function ZoomGlassIcon({ variant }: { variant: "in" | "out" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="8" y1="11" x2="14" y2="11" />
      {variant === "in" && <line x1="11" y1="8" x2="11" y2="14" />}
    </svg>
  );
}

/** Zoom in/out control pair, shared by the admin tagging canvas and every ReviewCanvas-based
 * page (validate, photo-view, photo-review) so the zoom affordance looks and behaves the same
 * everywhere. Callers supply the actual zoom handlers — this component is purely presentational. */
export function ZoomButtons({
  onZoomOut,
  onZoomIn,
  className,
}: {
  onZoomOut: () => void;
  onZoomIn: () => void;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-1 ${className ?? ""}`}>
      <button
        type="button"
        onClick={onZoomOut}
        title="Zoom out (Ctrl -)"
        className="flex items-center justify-center rounded-md border border-gray-300 p-1.5 text-gray-600 hover:bg-gray-50 hover:text-gray-900"
      >
        <ZoomGlassIcon variant="out" />
      </button>
      <button
        type="button"
        onClick={onZoomIn}
        title="Zoom in (Ctrl +)"
        className="flex items-center justify-center rounded-md border border-gray-300 p-1.5 text-gray-600 hover:bg-gray-50 hover:text-gray-900"
      >
        <ZoomGlassIcon variant="in" />
      </button>
    </div>
  );
}
