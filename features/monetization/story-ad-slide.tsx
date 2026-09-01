"use client";

import { useEffect, useRef, useState } from "react";

import { hilltopZoneSource, type HilltopConfig } from "@/lib/monetization/hilltop-config";

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
  /*
    🔴 THE VIDEO PATH, WHEN THIS MOMENT IS SET TO ONE (owner, 2026-09-01:
    "history view after 3 view is showing banner instead of vast that shows on
    interstilla").

    `AdSlot` below has no video branch, so this slide could only ever render a
    banner — which is why it was configured with one. The video the owner means
    is the VAST interstitial, and `requestVastInterstitial` is the only thing
    that plays one, so this moment now asks IT when its source is `vast`.

    The overlay is portalled and full-screen, so it simply covers this slide
    while it plays. When it resolves — shown, skipped, or nothing to show — the
    queue advances, which is exactly what the tap zones below would have done.

    `onResolved(false)` in that case, deliberately: this component renders no ad
    of its own on the video path, and telling the player otherwise would have it
    hold a slide with nothing in it.
  */
  const [mode, setMode] = useState<"unknown" | "vast" | "slot">("unknown");
  const fired = useRef(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/ads/config")
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { hilltop?: HilltopConfig }) => {
        if (!alive) return;
        setMode(
          d.hilltop && hilltopZoneSource(d.hilltop, zone) === "vast" ? "vast" : "slot",
        );
      })
      .catch(() => alive && setMode("slot"));
    return () => {
      alive = false;
    };
  }, [zone]);

  useEffect(() => {
    if (mode !== "vast" || fired.current) return;
    fired.current = true;
    onResolved(false);
    void import("./vast-interstitial/request")
      .then((m) => m.requestVastInterstitial("history-story"))
      .catch(() => {
        /* A slide that cannot load its ad must still advance. */
      })
      .finally(onNext);
  }, [mode, onNext, onResolved]);

  // Nothing of our own on the video path — the overlay owns the screen.
  if (mode !== "slot") return null;

  return (
    <div
      /*
        🔴 `fixed`, and ABOVE the player (owner, 2026-08-30: "the story player
        is not showing").

        It was `absolute inset-0 z-30`, which is wrong twice over. This renders
        as a SIBLING of the player, not a child of it — so `absolute` resolved
        against the document rather than the viewport, and z-30 put it BEHIND
        `PlayerInner`, which is `fixed inset-0 z-[92]`. The ad was mounting and
        firing correctly the whole time, underneath an opaque player.

        `z-[95]` clears the player but stays under the sheet layer at z-[95]+
        that the player's own menus use, so a menu opened before the ad still
        wins rather than being trapped behind it.
      */
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black"
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
        /*
          🔴 THE CREATIVE IS CLICKABLE (owner, 2026-09-01: "the video ad in
          history view doesnt support click because of the implemented right
          click for nexting ... users should be able to click").

          This was `pointer-events-none`, which made the ad unclickable
          everywhere, and the centre tap zone that was supposed to compensate
          carried a `data-story-ad-click` attribute that NOTHING has ever read
          and no `onClick` at all. So "centre tap opens the advertiser" was
          documented in the zone metadata, in the comment below, and implemented
          nowhere: every tap either skipped the ad or did nothing.

          It cannot be fixed by handling the centre tap ourselves either — the
          creative is usually a cross-origin iframe, and a click cannot be
          synthesised into one. The tap has to reach it natively, so the layer
          above has to have a HOLE in it rather than a button.
        */
        className="flex h-full w-full items-center justify-center"
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

          🔴 A HOLE, NOT A BUTTON. `pointer-events-none` on this one element is
          what lets a centre tap fall THROUGH the navigation layer and land on
          the creative underneath, which is the only way a cross-origin ad
          iframe can ever be clicked. It was a `<button>` with no handler, which
          is the most effective way to swallow a tap that there is.
        */}
        <div aria-hidden className="pointer-events-none h-full flex-[0_0_30%]" />
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
