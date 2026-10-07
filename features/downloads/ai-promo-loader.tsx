"use client";

import { useEffect, useState, type ComponentType } from "react";

import type { AiPromo } from "@/lib/ai/promo/config";

/**
 * The landing promotion's loader (Brief C §8–§9): a few hundred bytes in the
 * page, the driver (video + before/after) fetched as its own small chunk.
 *
 * 🔴 STARTS AT HYDRATION, LIKE THE WALLPAPER TILE (owner, 2026-10-07: "the
 * promo AI button takes too long to show the showcase medias, making users not
 * to see it probably before they start downloading, it should be like the
 * wallpaper button"). It used to wait for the page's `load`, then idle time,
 * then the admin's delay, then the intro — several seconds in which a visitor
 * had already pasted a link. The Wallpapers tile beside it rotates from its
 * first paint. The chunk is tiny and the media are pre-sized webp/MP4 on the
 * storage CDN, so starting now costs the hero nothing measurable; the LCP is
 * the hero, never this tile.
 */
export function AiPromoLoader({ promo }: { promo: AiPromo }) {
  const [Driver, setDriver] = useState<ComponentType<{ promo: AiPromo }> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("@/features/downloads/ai-promo-driver").then((m) => {
      if (!cancelled) setDriver(() => m.AiPromoDriver);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return Driver ? <Driver promo={promo} /> : null;
}
