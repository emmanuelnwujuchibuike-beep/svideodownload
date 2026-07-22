"use client";

import { useEffect, useState } from "react";

/**
 * The admin-set interstitial skip delay (seconds): 0 = skip immediately, else a
 * countdown. Fetched once from `/api/ads/config` and memoised process-wide, so
 * every interstitial shares one request. Defaults to 5s until it resolves, which
 * is the same default the server uses — so a mount before the fetch lands never
 * flashes the wrong control.
 */
let cached: number | null = null;
let inflight: Promise<void> | null = null;

export function useInterstitialSkipSeconds(): number {
  const [seconds, setSeconds] = useState<number>(cached ?? 5);

  useEffect(() => {
    if (cached !== null) {
      setSeconds(cached);
      return;
    }
    inflight ??= fetch("/api/ads/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        cached = typeof d?.interstitialSkipSeconds === "number" ? d.interstitialSkipSeconds : 5;
      })
      .catch(() => {
        cached = 5;
      })
      .finally(() => {
        inflight = null;
      });

    let alive = true;
    void inflight.then(() => {
      if (alive && cached !== null) setSeconds(cached);
    });
    return () => {
      alive = false;
    };
  }, []);

  return seconds;
}
