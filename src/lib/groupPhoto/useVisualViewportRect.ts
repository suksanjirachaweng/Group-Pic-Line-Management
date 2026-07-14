"use client";

import { useEffect, useState } from "react";

export type VisualViewportRect = { top: number; height: number };

/**
 * Tracks `window.visualViewport`'s currently-visible rect (top offset + height) — this is the
 * one browser API purpose-built to shrink/move correctly when the on-screen keyboard opens,
 * unlike `window.innerHeight`, which doesn't reliably reflect that on every mobile browser. Used
 * to center a floating edit dialog within whatever space is actually still visible above the
 * keyboard, rather than the full (keyboard-obscured) layout viewport.
 *
 * Only listens while `enabled` is true (pass e.g. "is a mobile edit dialog currently open"), so a
 * page that never needs this never pays for the listener. Guards against a transient 0-height
 * reading `visualViewport` can emit mid-resize, which would otherwise collapse the tracked rect.
 */
export function useVisualViewportRect(enabled: boolean): VisualViewportRect | null {
  const [rect, setRect] = useState<VisualViewportRect | null>(null);

  // Reset the stale rect the moment `enabled` flips off, derived during render (not an effect)
  // per React's "you might not need an effect" guidance — same pattern as ReviewCanvas's
  // syncedTagId/TagListSidebar's prevTags/TagEditDialog's syncedInitial.
  const [syncedEnabled, setSyncedEnabled] = useState(enabled);
  if (enabled !== syncedEnabled) {
    setSyncedEnabled(enabled);
    if (!enabled) setRect(null);
  }

  useEffect(() => {
    if (!enabled) return;
    const vv = window.visualViewport;
    if (!vv) return;
    function update() {
      if (!vv || vv.height <= 0) return;
      setRect({ top: vv.offsetTop, height: vv.height });
    }
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [enabled]);

  return rect;
}
