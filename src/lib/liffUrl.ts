/** Builds the shared LIFF registration entry URL for a given channel + university slug. */
export function buildLiffRegisterUrl(liffId: string, universitySlug: string): string {
  const url = new URL(`https://liff.line.me/${liffId}`);
  url.searchParams.set("university", universitySlug);
  url.searchParams.set("liffId", liffId);
  return url.toString();
}
