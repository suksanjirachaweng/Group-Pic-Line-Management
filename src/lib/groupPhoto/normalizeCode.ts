/**
 * Group-photo codes carry a decorative letter prefix that varies (e.g. "B1710") on top of the
 * real numeric code ("1710") used everywhere else — confirmed by cross-referencing real sample
 * data. Strip everything but digits so codes compare equal regardless of prefix convention.
 */
export function normalizeCode(raw: string): string {
  return raw.replace(/\D+/g, "");
}
