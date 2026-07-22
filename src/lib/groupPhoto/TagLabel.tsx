export type TagDisplayField = "order" | "code" | "name" | "line";

/**
 * A pin/teardrop marker whose TIP (not its bounding box) sits exactly on the tagged (x,y) point —
 * a plain dot only communicates "somewhere around here," which gets ambiguous once markers are
 * small or crowded together. Must be rendered inside a wrapper positioned at that exact point
 * with no centering transform (unlike a symmetric dot, a pin's own box isn't centered on the
 * point it's marking) — see the `-45deg` rotation anchored at the box's own bottom-left corner,
 * which is what keeps that corner fixed exactly at the wrapper's origin while the rest of the
 * shape swings into place. Shared by the admin tagging canvas and the read-only review canvas so
 * every page draws marks the same way.
 */
export function TagMarker({
  color,
  size = 14,
  ring,
  pulse,
  title,
}: {
  color: string;
  size?: number;
  ring?: string;
  pulse?: boolean;
  title?: string;
}) {
  return (
    <div
      className={`absolute ${pulse ? "animate-pulse" : ""}`}
      style={{
        left: 0,
        top: -size,
        width: size,
        height: size,
        backgroundColor: color,
        border: ring ? "2px solid white" : "none",
        borderRadius: "50% 50% 50% 0",
        transform: "rotate(-45deg)",
        transformOrigin: "0% 100%",
        boxShadow: ring,
      }}
      title={title}
    />
  );
}

export const ALL_TAG_DISPLAY_FIELDS: { field: TagDisplayField; label: string }[] = [
  { field: "order", label: "ลำดับ" },
  { field: "code", label: "รหัส" },
  { field: "name", label: "ชื่อ-นามสกุล" },
  { field: "line", label: "เส้นต่อ" },
];

/** Checkbox row for picking which fields render on markers — shared by the admin tagging canvas
 * and the public validate page so both toggles look and behave the same. */
export function TagDisplayFieldPicker({
  value,
  onChange,
}: {
  value: Set<TagDisplayField>;
  onChange: (next: Set<TagDisplayField>) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs">
      {ALL_TAG_DISPLAY_FIELDS.map(({ field, label }) => {
        const checked = value.has(field);
        return (
          <label key={field} className="flex cursor-pointer select-none items-center gap-1.5 font-medium text-gray-700">
            <input
              type="checkbox"
              checked={checked}
              onChange={() => {
                const next = new Set(value);
                if (next.has(field)) next.delete(field);
                else next.add(field);
                onChange(next);
              }}
              className="h-4 w-4 rounded border-gray-300 accent-indigo-600"
            />
            {label}
          </label>
        );
      })}
    </div>
  );
}

/**
 * Marker label shown next to each tagged point. Concatenating fields onto one line gets
 * unreadable once more than one is enabled (long names next to a code, rotated at an angle) —
 * instead this stacks a small order badge beside a two-line code/name block, shared by the
 * admin tagging canvas and the read-only review canvas so both stay visually consistent.
 */
export function TagLabel({
  order,
  code,
  name,
  color,
  fields,
  angle,
}: {
  order: number;
  code: string;
  name: string;
  color: string;
  fields: Set<TagDisplayField>;
  angle: number;
}) {
  const showOrder = fields.has("order");
  const showCode = fields.has("code");
  const showName = fields.has("name");
  if (!showOrder && !showCode && !showName) return null;

  const displayName = name.trim() || "(ยังไม่มีชื่อ)";

  return (
    <div
      className="absolute left-0 top-0 flex origin-left items-center gap-1 rounded-md py-0.5 pl-0.5 pr-1.5 shadow-md ring-1 ring-black/10"
      // Lifted up and right, clear of the marker itself (see TagMarker) — the now-borderless dot
      // is the same color as this label and needs real clearance, not just a few px, to stay
      // visible instead of hiding underneath it. Was -6px/no X-shift, which worked back when the
      // marker itself had a white ring to peek through with.
      style={{ backgroundColor: color, transform: `translate(6px, -22px) rotate(${angle}deg)` }}
    >
      {showOrder && (
        <span className="flex h-4 min-w-[16px] items-center justify-center rounded bg-black/25 px-1 text-[10px] font-bold leading-none text-white">
          {order}
        </span>
      )}
      {(showCode || showName) && (
        <span className="flex flex-col justify-center gap-0.5 leading-none">
          {showCode && <span className="whitespace-nowrap font-mono text-[12px] font-bold text-white">{code}</span>}
          {showName && (
            <span className="whitespace-nowrap text-[11px] font-medium text-white/90">{displayName}</span>
          )}
        </span>
      )}
    </div>
  );
}
