"use client";

import { useCallback, useEffect, useRef } from "react";

import { useShowAds } from "@/features/monetization/use-show-ads";
import type { DirectLinkSpot } from "@/lib/monetization/direct-link";

/**
 * The Monetag direct link at one spot (lib/monetization/direct-link.ts).
 *
 * Returns `maybeOpen`, to call INSIDE a tap's own handler: browsers only let a
 * new tab open synchronously within the gesture, so the opener is loaded ahead
 * (its own chunk, direct-link-runtime.ts, after mount) and the call never awaits.
 * Free plan only (no placement passed to useShowAds), and never on the
 * sign-in/profile routes. Every tap at the spot may open it (no session lock).
 */
export function useDirectLink(spot: DirectLinkSpot | null): () => boolean {
  const { showAds, ready } = useShowAds();
  const opener = useRef<(() => void) | null>(null);

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

  // true when this spot has a direct link set up (it then rolls the admin's chance and opens it); false = nothing to open
  return useCallback(() => {
    if (!opener.current) return false;
    opener.current();
    return true;
  }, []);
}

/**
 * A close control that first opens the Monetag direct link (owner, 2026-10-20: "make the whole X button open
 * the Monetag direct link and still close the ad when the user comes back"; 2026-10-23: the PAID full-screen
 * ad's X never did). The link opens in a new tab inside the tap itself; the ad closes when this tab is
 * visible again — or after 4 s if the tab never went hidden (a blocked pop-up), so the control can never
 * leave the ad stuck. With no link set up for the spot it simply closes. Shared by every ad close button.
 */
export function useCloseViaDirectLink(spot: DirectLinkSpot | null, close: () => void): () => void {
  const openDirectLink = useDirectLink(spot);
  return useCallback(() => {
    if (!openDirectLink()) {
      close();
      return;
    }
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
  }, [openDirectLink, close]);
}
