// Only ever strips a generic civilian honorific (male/female/child, no information beyond
// gender/age) — never a professional/academic/rank title (นพ., พญ., ผศ., รศ., ศ., ดร., ร.ด., ฯลฯ),
// since those convey real information the legacy-reference list should keep. Each pattern
// requires the title to be followed by whitespace (or, for already-abbreviated forms like น.ส./
// ด.ช., allows none) so a title that's fused directly onto a longer meaningful word — e.g.
// "นายแพทย์" ("male doctor", no space) — is left untouched rather than mangled into "แพทย์...".
const STRIPPABLE_TITLE_PATTERNS: RegExp[] = [
  /^นางสาว\s+/,
  /^นาง\s+/,
  /^นาย\s+(?!แพทย์)/,
  /^น\.ส\.\s*/,
  /^นส\.\s*/,
  /^เด็กชาย\s+/,
  /^เด็กหญิง\s+/,
  /^ด\.ช\.\s*/,
  /^ด\.ญ\.\s*/,
  /^(mr|mrs|ms|miss)\.?\s+/i,
];

/** Strips a leading plain honorific (นาย/นาง/นางสาว/น.ส./นส./Mr./Mrs./Ms./Miss/etc.) off an
 * imported legacy-reference name, leaving meaningful title prefixes (professional, academic,
 * military/rank) untouched. At most one prefix is stripped per name. */
export function stripNameTitle(rawName: string): string {
  const name = rawName.trim();
  for (const pattern of STRIPPABLE_TITLE_PATTERNS) {
    if (pattern.test(name)) {
      return name.replace(pattern, "").trim();
    }
  }
  return name;
}
