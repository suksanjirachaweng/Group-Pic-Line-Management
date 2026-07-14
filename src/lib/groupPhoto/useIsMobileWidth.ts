"use client";

import { useLayoutEffect, useState } from "react";

/**
 * Whether the viewport is at or below Tailwind's `md:` breakpoint (768px) — width-only, so
 * (unlike an orientation or aspect-ratio check) this is safe to keep live-reactive via
 * `matchMedia`'s own "change" listener: the on-screen keyboard never changes the viewport's
 * WIDTH, only its height, so this can't be spuriously triggered by a keyboard opening the way
 * `useIsLandscapeMobile` can (see its doc comment for the full story).
 *
 * `useLayoutEffect`, not `useEffect`: on a real mobile device this starts out `false` (there's no
 * `window` during SSR to check), so a plain `useEffect` would paint one frame in the desktop
 * layout, then flip and re-layout — visible as content jumping around right after load (reported
 * as the sidebar list "bouncing" into place). `useLayoutEffect` corrects the value before the
 * browser paints, so that wrong frame is never actually shown. Safe here because this hook is
 * only ever used from "use client" components.
 */
export function useIsMobileWidth(): boolean {
  const [value, setValue] = useState(false);

  useLayoutEffect(() => {
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
