const THAI_DIGITS = ["๐", "๑", "๒", "๓", "๔", "๕", "๖", "๗", "๘", "๙"];

export function toThaiNumeral(n: number): string {
  return String(n)
    .split("")
    .map((d) => THAI_DIGITS[Number(d)] ?? d)
    .join("");
}

/** Exact 7-column header row/order the legacy desktop tool's export used. */
export const LEGACY_EXCEL_HEADERS = ["ชื่อ-นามสกุล", "CODE", "แถว", "ลำดับ", "X", "Y", "คณะ"] as const;

export type TagForExport = { name: string; code: string; row: number; order: number; x: number; y: number };

/**
 * Row-caption text export, byte-for-byte format confirmed against real sample "- visio.txt"
 * files: row 0 label gets a single tab before names, row N>=1 gets two tabs; the row number in
 * "แถวยืนที่ N จากซ้าย" is a Thai numeral, not an Arabic digit; every line ends with a trailing
 * ", " before the CRLF line break.
 */
export function buildRowCaptionText(tags: Pick<TagForExport, "name" | "row" | "order">[]): string {
  const byRow = new Map<number, string[]>();
  for (const t of tags) {
    const names = byRow.get(t.row) ?? [];
    names[t.order] = t.name;
    byRow.set(t.row, names);
  }

  const rows = [...byRow.keys()].sort((a, b) => a - b);
  const lines = rows.map((row) => {
    const names = (byRow.get(row) ?? []).filter(Boolean);
    const namesText = names.length > 0 ? `${names.join(", ")}, ` : "";
    const label = row === 0 ? "แถวหน้านั่งจากซ้าย" : `แถวยืนที่ ${toThaiNumeral(row)} จากซ้าย`;
    const tabs = row === 0 ? "\t" : "\t\t";
    return `${label}${tabs}${namesText}`;
  });

  return lines.join("\r\n") + "\r\n";
}
