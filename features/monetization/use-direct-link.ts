"use client";

import { useCallback, useEffect, useRef } from "react";

import { useShowAds } from "@/features/monetization/use-show-ads";
import { loadAdsConfig } from "@/lib/monetization/ads-config-client";
import { directLinkRollWins, isValidDirectLinkUrl, type DirectLinkSpot } from "@/lib/monetization/direct-link";

type Served = { url: string; spots: string[]; chancePercent: number } | null;

const seenKey = (spot: DirectLinkSpot) => `frenz:direct-link:${spot}`;

/**
 * The Monetag direct link at one spot (lib/monetization/direct-link.ts).
 *
 * Returns `maybeOpen`, to call INSIDE a tap's own handler: browsers only let a
 * new tab open synchronously within the gesture, so the config is read ahead
 * (the shared /api/ads/config fetch) and the call itself never awaits.
 * Free plan only (no placement passed to useShowAds), and never on the
 * sign-in/profile routes. Once it has opened at a spot, that spot is quiet for
 * the rest of the session.
 */
export function useDirectLink(spot: DirectLinkSpot): () => void {
  const { showAds, ready } = useShowAds();
  const served = useRef<Served>(null);

  useEffect(() => {
    if (!ready || !showAds) return;
    let alive = true;
    void loadAdsConfig().then((d) => {
      if (alive) served.current = ((d as Record<string, unknown>)?.monetagDirectLink as Served) ?? null;
    });
    return () => {
      alive = false;
    };
  }, [ready, showAds]);

  return useCallback(() => {
    const c = served.current;
    if (!ready || !showAds || !c || !c.spots?.includes(spot) || !isValidDirectLinkUrl(c.url)) return;
    try {
      if (sessionStorage.getItem(seenKey(spot))) return;
    } catch {
      /* Storage blocked: fall through — the roll still keeps it occasional. */
    }
    if (!directLinkRollWins(c.chancePercent, Math.random())) return;
    try {
      sessionStorage.setItem(seenKey(spot), "1");
    } catch {
      /* ignore */
    }
    window.open(c.url, "_blank", "noopener,noreferrer");
  }, [ready, showAds, spot]);
}
