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
  /** Batch downloads are free, paid for by the two ads below. */
  batchDownload: boolean;
  /** Seconds the PRE-batch ad must run before it can be skipped. */
  batchGateSeconds: number;
  /** Seconds the POST-batch ad must run before it can be skipped. */
  batchCompleteSeconds: number;
  /** How many of a download's best-quality format options (per kind) are
   *  reward-gated — see lib/monetization/reward-policy.ts. */
  rewardTopTierCount: number;
  /** Seconds a top-tier VIDEO reward ad must run (never skippable). */
  rewardVideoTopTierSeconds: number;
  /** Seconds a top-tier IMAGE/AUDIO reward ad runs. */
  rewardImageAudioTopTierSeconds: number;
  /** Seconds before the top-tier IMAGE/AUDIO ad's Skip control appears. */
  rewardImageAudioSkipAfterSeconds: number;
}

const DEFAULTS: InterstitialConfig = {
  skipSeconds: 5,
  wallpaper: false,
  historyVideo: false,
  // OFF by default like every other interstitial — but note the consequence
  // here is the opposite of the others: with this off, batch downloads simply
  // run with no ad. A failed config fetch gives the feature away rather than
  // showing an ad nobody configured.
  batchDownload: false,
  batchGateSeconds: 30,
  batchCompleteSeconds: 5,
  rewardTopTierCount: 2,
  rewardVideoTopTierSeconds: 30,
  rewardImageAudioTopTierSeconds: 5,
  rewardImageAudioSkipAfterSeconds: 5,
};

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
          batchDownload: d?.interstitialBatchDownload === true,
          batchGateSeconds:
            typeof d?.batchGateSeconds === "number" ? d.batchGateSeconds : DEFAULTS.batchGateSeconds,
          batchCompleteSeconds:
            typeof d?.batchCompleteSeconds === "number" ? d.batchCompleteSeconds : DEFAULTS.batchCompleteSeconds,
          rewardTopTierCount:
            typeof d?.rewardTopTierCount === "number" ? d.rewardTopTierCount : DEFAULTS.rewardTopTierCount,
          rewardVideoTopTierSeconds:
            typeof d?.rewardVideoTopTierSeconds === "number"
              ? d.rewardVideoTopTierSeconds
              : DEFAULTS.rewardVideoTopTierSeconds,
          rewardImageAudioTopTierSeconds:
            typeof d?.rewardImageAudioTopTierSeconds === "number"
              ? d.rewardImageAudioTopTierSeconds
              : DEFAULTS.rewardImageAudioTopTierSeconds,
          rewardImageAudioSkipAfterSeconds:
            typeof d?.rewardImageAudioSkipAfterSeconds === "number"
              ? d.rewardImageAudioSkipAfterSeconds
              : DEFAULTS.rewardImageAudioSkipAfterSeconds,
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
