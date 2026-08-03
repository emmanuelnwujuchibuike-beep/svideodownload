"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import { WallpaperInterstitial } from "@/features/wallpapers/wallpaper-gallery";
import { WallpaperReels } from "@/features/wallpapers/wallpaper-reels";
import type { Wallpaper } from "@/lib/wallpapers";

/**
 * /wallpapers — the standalone Explore surface, opened from the landing's
 * "Explore wallpapers" button.
 *
 * Straight into the reels viewer: the whole page IS the viewer, so there is no
 * intermediate grid to get through and no second tap before the artwork.
 * Closing it goes back where the visitor came from.
 *
 * ── The rules the owner set for this surface ──────────────────────────────────
 *  • A signed-out visitor can scroll the entire library and download from it.
 *  • Liking, saving and commenting belong to signed-in members on the DOWNLOAD
 *    page, so `canEngage` is false here for anyone signed out; the viewer then
 *    offers a sign-in rather than silently swallowing the tap.
 *  • The skippable interstitial fires after the visitor's SECOND completed
 *    download, not the first — one free download before any interruption.
 */
export function WallpaperExplore({ items, canEngage }: { items: Wallpaper[]; canEngage: boolean }) {
  const router = useRouter();
  const [adOpen, setAdOpen] = useState(false);
  // A ref, not state: incrementing a counter must not re-render the viewer and
  // interrupt a scroll in progress.
  const downloads = useRef(0);

  const onDownloaded = useCallback(() => {
    downloads.current += 1;
    // Second download onwards. The first is uninterrupted.
    if (downloads.current >= 2) setAdOpen(true);
  }, []);

  return (
    <>
      <WallpaperReels
        items={items}
        canEngage={canEngage}
        onClose={() => router.back()}
        onDownloaded={onDownloaded}
      />
      {adOpen ? <WallpaperInterstitial onClose={() => setAdOpen(false)} /> : null}
    </>
  );
}
