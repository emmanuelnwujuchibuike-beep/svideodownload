"use client";

import { useCallback, useRef, useState } from "react";

import { useInterstitialConfig } from "@/features/monetization/use-interstitial-skip";

/**
 * The wallpaper download interstitial trigger (owner, 2026-08-04): a skippable
 * full-screen ad after every 2 wallpaper downloads.
 *
 * Shared by BOTH surfaces — the standalone /wallpapers page and the download
 * page's Wallpapers section — because they used to disagree: the standalone page
 * fired from the 2nd download onwards, while the download page fired on EVERY
 * single one. Owning the rule in one hook is what stops the two drifting again.
 *
 * ── Why the count is a ref, not state ────────────────────────────────────────
 * Incrementing it must not re-render the reels viewer: a re-render mid-scroll
 * interrupts the scroll-snap the whole viewer depends on. Only the visibility of
 * the ad is state.
 *
 * ── Every 2, not "from 2 onwards" ────────────────────────────────────────────
 * The 1st download is never interrupted, the 2nd is, the 3rd isn't, the 4th is.
 * A modulo rather than a threshold, so a visitor downloading ten wallpapers sees
 * five ads rather than nine.
 */
const EVERY = 2;

export function useWallpaperInterstitial(): {
  /** Whether the interstitial should be on screen right now. */
  adOpen: boolean;
  /** Call after each COMPLETED wallpaper download. */
  onDownloaded: () => void;
  close: () => void;
} {
  const { wallpaper: enabled } = useInterstitialConfig();
  const [adOpen, setAdOpen] = useState(false);
  const downloads = useRef(0);

  const onDownloaded = useCallback(() => {
    downloads.current += 1;
    // The admin switch is checked at the MOMENT of the download, not at mount,
    // so turning it off takes effect on the next download rather than needing a
    // reload. The count still runs either way, so enabling it mid-session
    // doesn't fire an ad for downloads that happened while it was off.
    if (!enabled) return;
    if (downloads.current % EVERY === 0) setAdOpen(true);
  }, [enabled]);

  const close = useCallback(() => setAdOpen(false), []);

  return { adOpen, onDownloaded, close };
}
