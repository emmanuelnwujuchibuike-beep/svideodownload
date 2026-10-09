"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { loadSelfAds } from "../serving-client";
import { AdDetailHost } from "./ad-detail-host";
import { SelfMoments } from "./self-moments";

/**
 * The site-wide paid MOMENTS (full-screen: a finished download, a return to
 * the tab, an AI save). Box slots — the top banner, content cards, the reels
 * slide — are filled by their existing containers through useSlotProvider. Loads the payload on mount (and, after the bucket turns over, on the
 * next page change), so a moment — a finished download — decides in the same
 * tick from memory.
 */
export function SelfAdsRoot() {
  const pathname = usePathname();
  // memoised per 5-minute bucket: a page change refreshes only when the bucket turned over
  useEffect(() => {
    void loadSelfAds();
  }, [pathname]);
  return (
    <>
      <SelfMoments />
      {/* a tapped ad opens its details on this page (2026-10-09) */}
      <AdDetailHost />
    </>
  );
}
