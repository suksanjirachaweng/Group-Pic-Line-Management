/**
 * The name to use for group-photo tagging/autofill purposes — prefers what the registrant
 * actually typed into the registration form's "ชื่อ-นามสกุล / Full Name" field (`data.full_name`)
 * over their LINE profile's own display name. The two routinely differ (a LINE nickname, an
 * English alias, emoji, a family member's shared LINE account, etc.) — `full_name` is what they
 * explicitly declared as their real name for this purpose, so it's the authoritative one here.
 * `displayName` is still the right choice elsewhere (LINE messaging/{{displayName}} templates,
 * the registrants list) — this helper is specifically for group-photo name matching/autofill.
 */
export function resolveRegistrantGroupPhotoName(registrant: { displayName: string | null; data: unknown }): string {
  const data = (registrant.data ?? {}) as Record<string, unknown>;
  const fullName = typeof data.full_name === "string" ? data.full_name.trim() : "";
  if (fullName) return fullName;
  return registrant.displayName?.trim() || "(ไม่มีชื่อ)";
}
