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
 * sign-in/profile routes. Once it has opened at a spot, that spot is quiet for
 * the rest of the session.
 */
export function useDirectLink(spot: DirectLinkSpot): () => void {
  const { showAds, ready } = useShowAds();
  const opener = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!ready || !showAds) return;
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

  return useCallback(() => opener.current?.(), []);
}
