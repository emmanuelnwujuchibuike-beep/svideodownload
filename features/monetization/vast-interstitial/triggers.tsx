"use client";

import { useEffect } from "react";

/**
 * Idle and back-swipe triggers for the ExoClick interstitial.
 *
 * ── Why this exists instead of the Monetag moments ────────────────────────────
 *
 * Owner, 2026-08-30: "it should work without the monetag, i dont want to use
 * monetag for idle or backswipe."
 *
 * The idle/return/back-swipe moments already in the product are Monetag-only:
 * `resolveMonetagPlacements` returns nothing while the Monetag master switch is
 * off, and each moment is a pasted Monetag tag. This drives the SAME two moments
 * from the ExoClick VAST interstitial instead, so they work with Monetag
 * switched off entirely.
 *
 * ── It adds nothing to the critical path ──────────────────────────────────────
 *
 * This component ships two event listeners and a timer — no ad code. The whole
 * interstitial (config fetch, VAST request, player) stays behind the same
 * dynamic `import()` the download trigger uses, so a cold page load is
 * unaffected and a visitor who never goes idle never loads any of it.
 *
 * Everything else is inherited rather than re-implemented: the session guard
 * (one ad at a time), the cooldown, the startup timeout and the fail-open
 * behaviour all live in `request.ts` and apply here unchanged.
 */

/** How long without interaction counts as idle. */
const IDLE_MS = 45_000;

/** Fire the interstitial, loading it only at that moment. */
function fire() {
  void import("./request")
    .then((m) => m.requestVastInterstitial())
    .catch(() => {
      /* An ad that cannot load its own module is not the visitor's problem. */
    });
}

export function VastInterstitialTriggers() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    /*
      IDLE. Re-armed on any real interaction, and never while the tab is
      hidden — a backgrounded tab would otherwise "go idle" instantly and have
      a full-screen ad waiting when the visitor returned, which is the most
      hostile possible version of this placement.
    */
    let timer: number | undefined;
    const arm = () => {
      window.clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      timer = window.setTimeout(fire, IDLE_MS);
    };
    const ACTIVITY = [
      "pointerdown",
      "pointermove",
      "keydown",
      "wheel",
      "touchstart",
      "scroll",
    ] as const;
    for (const e of ACTIVITY) window.addEventListener(e, arm, { passive: true });
    document.addEventListener("visibilitychange", arm);

    /*
      BACK-SWIPE. `popstate` is the one signal that covers the iOS edge-swipe,
      the Android back gesture and the browser's own back button alike.

      🔴 It does NOT trap the back navigation. The page has already changed by
      the time this fires — the ad appears over the destination, and the visitor
      can still leave. Anything that cancelled or re-pushed history here would be
      the back-button trap the PWA work has removed twice.
    */
    const onPop = () => fire();
    window.addEventListener("popstate", onPop);

    arm();
    return () => {
      window.clearTimeout(timer);
      for (const e of ACTIVITY) window.removeEventListener(e, arm);
      document.removeEventListener("visibilitychange", arm);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  return null;
}
