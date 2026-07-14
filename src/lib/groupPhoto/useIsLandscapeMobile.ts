"use client";

import { useEffect, useState } from "react";

function computeIsLandscapeMobile(): boolean {
  const isLandscape = window.innerWidth > window.innerHeight;
  // Deliberately the CURRENT width against Tailwind's exact `max-md:` cutoff (768px), not the
  // device's shorter side — this mirrors the original `max-md:landscape:` CSS variant's actual
  // behavior exactly (a wide-enough phone in landscape already fell through to the plain `md:`
  // desktop layout before this fix, and should keep doing so). `innerWidth` never changes when
  // the on-screen keyboard opens (only height does), so this half of the check was never the
  // source of the keyboard bug — recomputing only on `orientationchange` (below) is what fixes it.
  const isWithinMaxMd = window.innerWidth <= 767;
  return isLandscape && isWithinMaxMd;
}

/**
 * Whether the viewport is currently a mobile-width device held in landscape — computed from
 * window dimensions, but ONLY recomputed on a genuine `orientationchange` event, deliberately
 * NOT on a live `matchMedia("(orientation: landscape)")` "change" listener or a plain `resize`
 * listener.
 *
 * Reason: on iOS Safari, opening the on-screen keyboard shrinks the *visual* viewport height
 * enough that width can exceed height even while the phone is held upright in portrait — which
 * makes a CSS `(orientation: landscape)` media query (and Tailwind's `landscape:` variant, which
 * compiles to exactly that) spuriously match mid-edit. That flipped this page's sidebar into its
 * two-column "landscape" layout — complete with the desktop-style vertical collapse toggle — the
 * instant someone tapped a name field to fix a typo, purely because the keyboard opened.
 * `orientationchange` only fires on an actual device rotation, so a value derived from it stays
 * correct even while the keyboard is open.
 */
export function useIsLandscapeMobile(): boolean {
  const [value, setValue] = useState(false);

  useEffect(() => {
    function recompute() {
      setValue(computeIsLandscapeMobile());
    }
    recompute();
    window.addEventListener("orientationchange", recompute);
    const orientation = window.screen?.orientation;
    orientation?.addEventListener("change", recompute);
    return () => {
      window.removeEventListener("orientationchange", recompute);
      orientation?.removeEventListener("change", recompute);
    };
  }, []);

  return value;
}
