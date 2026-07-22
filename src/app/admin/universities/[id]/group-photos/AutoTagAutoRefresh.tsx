"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Invisible — just re-runs this list's server-side data fetch every few seconds while any photo
 * has a background quick-tag job in progress, so the progress bars next to each photo actually
 * move instead of only updating on a manual reload. One poller for the whole list rather than one
 * per row (which the badges used to do individually) — with several jobs active at once that'd be
 * several redundant router.refresh() calls firing in the same tick for no benefit.
 */
export function AutoTagAutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(interval);
  }, [active, router]);

  return null;
}
