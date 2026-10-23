"use client";

import { useCallback, useEffect, useRef } from "react";

import { useShowAds } from "@/features/monetization/use-show-ads";
import type { DirectLinkSpot } from "@/lib/monetization/direct-link";
import type { SpotOutcome } from "@/lib/monetization/spot-popunder";

type Opener = (onOutcome?: (o: SpotOutcome) => void) => boolean;

/**
 * The ad formats at one spot: the Monetag POP-UNDER first, the direct link as its backup
 * (lib/monetization/spot-popunder.ts, lib/monetization/direct-link.ts).
 *
 * Returns `maybeOpen`, to call INSIDE a tap's own handler: browsers only let a new tab open within
 * the gesture, so the opener is loaded ahead (its own chunk, direct-link-runtime.ts, after mount)
 * and the call never awaits. It answers whether anything is set up here; `onOutcome` says what
 * actually opened ("popunder" | "direct" | "none"). Free plan only (no placement passed to
 * useShowAds), and never on the sign-in/profile routes. Every tap at the spot may open (no lock).
 * The element carrying the spot should have `data-ad-spot={spot}` so a press arms the pop-under early.
 */
export function useDirectLink(spot: DirectLinkSpot | null): (onOutcome?: (o: SpotOutcome) => void) => boolean {
  const { showAds, ready } = useShowAds();
  const opener = useRef<Opener | null>(null);

  useEffect(() => {
    if (!spot || !ready || !showAds) return;
    let alive = true;
    void import("./direct-link-runtime")
      .then((m) => m.loadDirectLinkOpener(spot))
      .then((open) => {
        if (alive) opener.current = open;
      })
      .catch(() => {
        /* No link is the safe direction. */
      });
    return () => {
      alive = false;
      opener.current = null;
    };
  }, [ready, showAds, spot]);

  // true when this spot has something set up (a pop-under to try, or a direct link to roll); false = nothing to open
  return useCallback((onOutcome?: (o: SpotOutcome) => void) => {
    if (!opener.current) return false;
    return opener.current(onOutcome);
  }, []);
}

/**
 * A close control that first opens the spot's ad (owner, 2026-10-20: "make the whole X button open
 * the Monetag direct link and still close the ad when the user comes back"; 2026-10-23: the pop-under
 * first, the direct link its backup). A pop-under opens BEHIND this tab, so the ad closes at once; a
 * direct link opens in front, so the ad closes when this tab is visible again — or after 4 s if it never
 * went hidden (a blocked pop-up), so the control can never leave the ad stuck. Nothing set up → it closes.
 */
export function useCloseViaDirectLink(spot: DirectLinkSpot | null, close: () => void): () => void {
  const openDirectLink = useDirectLink(spot);
  return useCallback(() => {
    const waitForReturn = () => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        document.removeEventListener("visibilitychange", onVisible);
        window.clearTimeout(timer);
        close();
      };
      const onVisible = () => {
        if (document.visibilityState === "visible") finish();
      };
      const timer = window.setTimeout(() => {
        if (document.visibilityState === "visible") finish();
      }, 4000);
      document.addEventListener("visibilitychange", onVisible);
    };
    const handled = openDirectLink((outcome) => (outcome === "direct" ? waitForReturn() : close()));
    if (!handled) close();
  }, [openDirectLink, close]);
}
