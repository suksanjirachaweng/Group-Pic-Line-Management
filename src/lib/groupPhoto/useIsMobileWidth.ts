"use client";

import { useEffect, useState } from "react";

/**
 * Whether the viewport is at or below Tailwind's `md:` breakpoint (768px) — width-only, so
 * (unlike an orientation or aspect-ratio check) this is safe to keep live-reactive via
 * `matchMedia`'s own "change" listener: the on-screen keyboard never changes the viewport's
 * WIDTH, only its height, so this can't be spuriously triggered by a keyboard opening the way
 * `useIsLandscapeMobile` can (see its doc comment for the full story).
 */
export function useIsMobileWidth(): boolean {
  const [value, setValue] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    function update() {
      setValue(mq.matches);
    }
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return value;
}
