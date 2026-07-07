import "server-only";

/** This deployment's own public base URL — reused from NextAuth's config rather than a separate env var. */
export function getAppBaseUrl(): string {
  const url = process.env.NEXTAUTH_URL;
  if (!url) throw new Error("NEXTAUTH_URL environment variable is not set");
  return url.replace(/\/$/, "");
}
