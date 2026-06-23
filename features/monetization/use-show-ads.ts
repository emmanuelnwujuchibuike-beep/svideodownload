"use client";

import { useEffect, useState } from "react";

// Module-level cache so we hit /api/me once per page load, not per component.
let cached: boolean | null = null;

/**
 * Whether to show ads to the current visitor (false for Pro/Business).
 * Optimistically assumes ads ON until `/api/me` resolves, so free users never
 * get a flash of "no ad"; premium users lose the ad a beat after load.
 */
export function useShowAds() {
  const [showAds, setShowAds] = useState<boolean>(cached ?? true);
  const [ready, setReady] = useState<boolean>(cached !== null);

  useEffect(() => {
    if (cached !== null) {
      setShowAds(cached);
      setReady(true);
      return;
    }
    let alive = true;
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : { showAds: true }))
      .then((d) => {
        cached = !!d.showAds;
        if (alive) {
          setShowAds(cached);
          setReady(true);
        }
      })
      .catch(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  return { showAds, ready };
}
