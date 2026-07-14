"use client";

import { useEffect, useLayoutEffect, useState } from "react";

const STORAGE_KEY = "groupphoto-validate-onboarding-dismissed";

/**
 * One-time "how this page works" overlay shown on `/validate` (desktop and mobile alike) —
 * click/tap a name in the list to focus the photo on it, double-click/double-tap to edit the
 * name. Persisted via localStorage (not scoped to a specific photo) so it only interrupts once
 * per browser, same "don't show again" convention as most desktop apps.
 */
export function ValidateOnboardingTip() {
  const [visible, setVisible] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [phase, setPhase] = useState<"click" | "dblclick">("click");

  // useLayoutEffect (not useEffect) so this resolves before the browser paints — SSR always
  // renders nothing (no `window` to check), so painting a first frame with the tip visible and
  // then a later frame without it (once localStorage says "dismissed") would flash. Also listens
  // for the `storage` event so dismissing the tip in one tab hides it in any other open tab too.
  useLayoutEffect(() => {
    function checkDismissed() {
      let dismissed = false;
      try {
        dismissed = localStorage.getItem(STORAGE_KEY) === "1";
      } catch {
        // localStorage can throw in private-browsing/blocked-storage contexts — just show the tip.
      }
      setVisible(!dismissed);
    }
    checkDismissed();
    window.addEventListener("storage", checkDismissed);
    return () => window.removeEventListener("storage", checkDismissed);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => {
      setPhase((p) => (p === "click" ? "dblclick" : "click"));
    }, 2200);
    return () => clearInterval(id);
  }, [visible]);

  function close() {
    if (dontShowAgain) {
      try {
        localStorage.setItem(STORAGE_KEY, "1");
      } catch {
        // Nothing to do if storage is unavailable — it'll just show again next visit.
      }
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm overflow-hidden rounded-xl border-4 border-black bg-white shadow-2xl">
        <div className="flex flex-col items-center gap-1.5 bg-yellow-400 px-5 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/nsl-logo.png" alt="Newsalon" className="h-7 w-auto" />
          <h2 className="text-center text-base font-black tracking-tight text-black">
            วิธีใช้งานหน้านี้
          </h2>
        </div>

        <div className="p-5">
          {/* Demo stage — cycles between the click-to-focus and double-click-to-edit examples
              every ~2.2s while the tip is open. */}
          <div className="relative flex h-32 items-center justify-center gap-5 overflow-hidden rounded-lg border-2 border-black bg-yellow-50">
            <div className="relative">
              <div
                className={`rounded-md border-2 px-3 py-2 text-xs font-bold transition-colors ${
                  phase === "click" || phase === "dblclick"
                    ? "border-black bg-yellow-400 text-black"
                    : "border-black/30 bg-white text-black/60"
                }`}
              >
                รายชื่อ
              </div>
              <span
                key={phase}
                className="pointer-events-none absolute inset-0 animate-ping rounded-md border-2 border-yellow-500"
                aria-hidden
              />
            </div>

            <span className="text-black" aria-hidden>
              →
            </span>

            <div className="relative h-16 w-20 shrink-0 overflow-hidden rounded-md border-2 border-black bg-black">
              <div
                className={`absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-yellow-400 transition-all duration-700 ${
                  phase === "click" || phase === "dblclick"
                    ? "left-1/2 top-1/2 scale-150"
                    : "left-3 top-3 scale-100"
                }`}
              />
              {phase === "dblclick" && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <div className="h-8 w-14 rounded border-2 border-yellow-400 bg-white shadow" />
                </div>
              )}
            </div>
          </div>

          <p className="mt-3 min-h-[2.5rem] text-center text-xs font-medium leading-snug text-black">
            {phase === "click"
              ? "คลิก/แตะที่รายชื่อ — ภาพจะโฟกัสไปตำแหน่งนั้นให้เอง"
              : "ดับเบิลคลิก/แตะ 2 ครั้ง — เปิดกล่องแก้ไขชื่อ"}
          </p>

          <label className="mt-4 flex items-center gap-2 text-xs text-black">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="accent-yellow-400"
            />
            ไม่ต้องแสดงข้อความนี้อีก
          </label>

          <button
            type="button"
            onClick={close}
            className="mt-3 w-full rounded-md border-2 border-black bg-yellow-400 py-2 text-sm font-black text-black hover:bg-yellow-300"
          >
            เข้าใจแล้ว
          </button>
        </div>
      </div>
    </div>
  );
}
