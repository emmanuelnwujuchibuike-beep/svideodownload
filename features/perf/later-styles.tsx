"use client";

import { useEffect } from "react";

/**
 * Loads the entry stylesheet right AFTER the first paint (owner, 2026-10-31: the landing and Download page "should be
 * below 1.6"). The landing and downloader pages paint with their own small sheet (app/landing.css: only what they
 * import statically). Everything they open later — a sheet, a dialog, the result card — is styled by the entry
 * sheet, which this fetches at the first idle moment (1.5 s at most), or at once on the first tap or key, so it is
 * in place before anything lazy can open. Renders nothing; one listener pair, removed once it has run.
 */
export function LaterStyles() {
  useEffect(() => {
    let done = false;
    const load = () => {
      if (done) return;
      done = true;
      void import("./later-styles-sheet").catch(() => {});
    };
    // Safari has no requestIdleCallback: a short timer there
    const ric = typeof window.requestIdleCallback === "function";
    const idle = ric ? window.requestIdleCallback(load, { timeout: 1500 }) : window.setTimeout(load, 800);
    window.addEventListener("pointerdown", load, { once: true, passive: true, capture: true });
    window.addEventListener("keydown", load, { once: true, capture: true });
    return () => {
      if (ric) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
      window.removeEventListener("pointerdown", load, { capture: true });
      window.removeEventListener("keydown", load, { capture: true });
    };
  }, []);
  return null;
}
