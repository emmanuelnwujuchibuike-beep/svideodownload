"use client";

import { useEffect, useState } from "react";

import { useRewardNetwork } from "@/features/monetization/use-interstitial-skip";

import { FullscreenInterstitial } from "./fullscreen-interstitial";

/**
 * The reward gate shown when a wallpaper download is tapped.
 *
 * Owner, 2026-08-30: "put a slot for exoclick to show a 5 secs reward full
 * screen like reels ad when the download wallpaper button is clicked, it should
 * be able to be switched when offerium approve so i can replace with offerium
 * reward ads."
 *
 * ── The switch already exists, and is reused rather than rebuilt ──────────────
 *
 * `lib/monetization/reward-networks.ts` already routes each reward MOMENT to its
 * own network, and `wallpaper` is already one of those moments. So "switchable
 * to Offerium later" is not new plumbing — it is the admin dropdown that is
 * already there, pointed at this gate. When Offerium is approved and its
 * postback seam is implemented, changing the network for the `wallpaper` moment
 * is all that is required, with no change here.
 *
 * ── It NEVER blocks the download ─────────────────────────────────────────────
 *
 * Same rule as the VAST interstitial: the ad is an optional enhancement. If the
 * zone is unseeded, the network is unavailable, or the creative never resolves,
 * `onDone` fires immediately and the wallpaper saves. A gate that can strand
 * someone between a tap and their file is worse than no gate.
 */
export function WallpaperRewardGate({
  open,
  onDone,
  /** Seconds before the gate can be dismissed. */
  seconds = 5,
}: {
  open: boolean;
  /** Called exactly once, whether the ad ran, failed, or never existed. */
  onDone: () => void;
  seconds?: number;
}) {
  /*
    Read only so the admin's per-moment routing is honoured. ExoClick serves it
    today through the shared zone stack; when the moment is pointed at Offerium
    this is where that branch lands.
  */
  const { network } = useRewardNetwork("wallpaper");
  const [remaining, setRemaining] = useState(seconds);
  const [hasAd, setHasAd] = useState<boolean | null>(null);

  // Reset per open, so a second download gets its own countdown.
  useEffect(() => {
    if (!open) return;
    setRemaining(seconds);
    setHasAd(null);
  }, [open, seconds]);

  // The countdown only runs while a creative is actually on screen — counting
  // down over a blank overlay would be charging the visitor for nothing.
  useEffect(() => {
    if (!open || hasAd !== true || remaining <= 0) return;
    const id = setTimeout(() => setRemaining((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [open, hasAd, remaining]);

  /*
    FAIL OPEN. No creative, or a slot that never answers, releases the download
    rather than holding it. The short delay on the unresolved case gives a slow
    network a moment to arrive without the visitor noticing a pause.
  */
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => {
      if (hasAd !== true) onDone();
    }, hasAd === false ? 0 : 2500);
    return () => clearTimeout(id);
  }, [open, hasAd, onDone]);

  /*
    🔴 MOUNTED ALWAYS, REVEALED ON TAP (owner: "the download button should load
    and prefetch the ad after the wallpaper have finished opening, so the ad
    opens instantly").

    Returning null until the gate opened meant the unit only began resolving its VAST and
    pulling an MP4 at the moment of the tap — a round trip plus a video download
    while someone waits for their wallpaper. Mounting it up front lets the
    creative buffer in advance, so revealing it is instant.

    Safe because the player no longer carries an autoplay attribute: playback
    starts from the IntersectionObserver, which cannot fire while this is
    hidden. That is what stopped the ad playing its AUDIO behind a hidden
    overlay.
  */
  return (
    <FullscreenInterstitial
      zone="wallpaper_reward"
      /* `=== true`: three-state, and "not false" would flash the overlay
         before the slot has said anything. */
      shown={open && hasAd === true}
      canSkip={remaining <= 0}
      remaining={remaining}
      onResolved={setHasAd}
      onClose={() => {
        if (remaining <= 0) onDone();
      }}
      data-reward-network={network}
    />
  );
}
