export type TagDisplayField = "order" | "code" | "name" | "line";

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
      style={{ backgroundColor: color, transform: `translateY(-6px) rotate(${angle}deg)` }}
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
