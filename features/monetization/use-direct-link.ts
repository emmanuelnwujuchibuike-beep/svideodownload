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
