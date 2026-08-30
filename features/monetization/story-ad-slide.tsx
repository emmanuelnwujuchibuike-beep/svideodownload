"use client";

import { AdSlot } from "./ad-slot";

/**
 * The full-screen story ad shown between history media.
 *
 * Owner, 2026-08-30: "after 3 media, the next should be a vertical full screen
 * video ad without going to the safe area like whatsapp status and can be next
 * by left tap but center tap opens the ad link."
 *
 * ── Inside the safe area, unlike the reels slide ──────────────────────────────
 *
 * The reels deck deliberately draws edge to edge under the status bar — it is a
 * full-bleed media surface and its chrome pads itself. A WhatsApp-status-style
 * card does the opposite: the media sits INSIDE the usable area with the notch
 * and the home indicator left alone, which is exactly what was asked for and
 * what the interstitial had to be corrected to do an hour earlier.
 *
 * `--frenz-safe-top` rather than `env(safe-area-inset-top)` because current iOS
 * reports that env as 0 in a standalone PWA — the project floors it in
 * globals.css, and every piece of chrome that stopped jamming under the status
 * bar uses that variable.
 *
 * ── Tap zones ────────────────────────────────────────────────────────────────
 *
 * Sides advance, centre opens the advertiser. The centre band is deliberately
 * the SMALLER target: an accidental tap should skip the ad, never navigate
 * someone off-site. `AdSlot` renders the creative underneath, and its own
 * click-through is suppressed here so these zones are the only thing that
 * decides what a tap means.
 */
export function StoryAdSlide({
  zone,
  onNext,
  onResolved,
}: {
  zone: "history_story_ad";
  /** Advance to the next real media item. */
  onNext: () => void;
  onResolved: (hasAd: boolean) => void;
}) {
  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black"
      role="dialog"
      aria-modal="true"
      aria-label="Advertisement"
      style={{
        paddingTop: "var(--frenz-safe-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      <AdSlot
        zone={zone}
        dismissible={false}
        fullBleed
        onResolved={onResolved}
        className="pointer-events-none flex h-full w-full items-center justify-center"
      />

      {/*
        The tap layer sits ABOVE the creative so the ad's own click target
        cannot claim a tap meant for navigation — which is how a story ad
        becomes a trap rather than something you can page past.
      */}
      <div className="absolute inset-0 z-10 flex">
        <button
          type="button"
          aria-label="Next"
          onClick={onNext}
          className="h-full flex-[0_0_35%] cursor-pointer bg-transparent"
        />
        {/*
          Centre — the advertiser. Narrower than the side zones on purpose: a
          mis-tap should cost the visitor an ad they were skipping anyway, not
          an unexpected trip to a third-party site.
        */}
        <button
          type="button"
          aria-label="Visit advertiser"
          data-story-ad-click
          className="h-full flex-[0_0_30%] cursor-pointer bg-transparent"
        />
        <button
          type="button"
          aria-label="Next"
          onClick={onNext}
          className="h-full flex-[0_0_35%] cursor-pointer bg-transparent"
        />
      </div>
    </div>
  );
}
