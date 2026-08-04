"use client";

import { useEffect, useState } from "react";

/**
 * The public interstitial config: the admin-set skip delay plus the per-moment
 * switches (wallpaper downloads, history video watches).
 *
 * Fetched ONCE from `/api/ads/config` and memoised process-wide, so every
 * interstitial on the page shares a single request. Defaults match the server's
 * own, so a component that mounts before the fetch lands never flashes the wrong
 * control — and both moment switches default OFF, so a slow or failed config
 * fetch can never turn an intrusive placement on by accident.
 */
export interface InterstitialConfig {
  /** 0 = skip immediately, else a countdown before the ad can be dismissed. */
  skipSeconds: number;
  wallpaper: boolean;
  historyVideo: boolean;
}

const DEFAULTS: InterstitialConfig = { skipSeconds: 5, wallpaper: false, historyVideo: false };

let cached: InterstitialConfig | null = null;
let inflight: Promise<void> | null = null;

export function useInterstitialConfig(): InterstitialConfig {
  const [config, setConfig] = useState<InterstitialConfig>(cached ?? DEFAULTS);

  useEffect(() => {
    if (cached !== null) {
      setConfig(cached);
      return;
    }
    inflight ??= fetch("/api/ads/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        cached = {
          skipSeconds: typeof d?.interstitialSkipSeconds === "number" ? d.interstitialSkipSeconds : DEFAULTS.skipSeconds,
          wallpaper: d?.interstitialWallpaper === true,
          historyVideo: d?.interstitialHistoryVideo === true,
        };
      })
      .catch(() => {
        cached = DEFAULTS;
      })
      .finally(() => {
        inflight = null;
      });

    let alive = true;
    void inflight.then(() => {
      if (alive && cached !== null) setConfig(cached);
    });
    return () => {
      alive = false;
    };
  }, []);

  return config;
}

/** Just the skip delay — the shape the download interstitial already uses. */
export function useInterstitialSkipSeconds(): number {
  return useInterstitialConfig().skipSeconds;
}
