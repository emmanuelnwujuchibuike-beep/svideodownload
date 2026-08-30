"use client";

import { ChevronUp } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { AdSlot } from "./ad-slot";

/**
 * One full-screen advertisement slide in the Reels deck.
 *
 * ── What this is, and what it deliberately is not ─────────────────────────────
 *
 * It is a SLIDE, not an overlay. The owner's choice (2026-08-30) between "a 4th
 * card in the deck" and "a vignette over the 4th reel" was the card, and the
 * distinction is the whole design: this never covers a video someone chose to
 * watch, never pauses one, and is dismissed by the swipe the viewer was already
 * making. It owns no `<video>` and never calls into
 * `lib/media/video-coordinator.ts`, so it cannot enter the largest-visible-video
 * calculation or claim playback from the reel above or below it.
 *
 * ── It reverses a documented decision, on the record ──────────────────────────
 *
 * "Ads are intentionally NOT global anymore — they live only on the marketing
 * landing page. The app/social surfaces are ad-free" (app/layout.tsx). This
 * slide is the deliberate exception, asked for by name, and it is the ONLY one:
 * every other social surface stays ad-free. It is also gated three ways — the
 * viewer's plan, whether the zone is seeded at all, and the ExoClick switch
 * being on — so the default remains an ad-free deck.
 */
export function ReelsAdSlide({ variant }: { variant: "modal" | "page" }) {
  /**
   * Whether the zone actually produced a visible creative.
   *
   * Null while unknown. The deck only composes this slide once it has confirmed
   * a row EXISTS for the zone, but a row is not a creative — ExoClick returns
   * nothing when it has no demand for the geo/device — so a slide can still end
   * up with an empty middle. That is what the fallback below is for: a
   * full-screen slide the viewer swiped into must never be a dead black
   * rectangle with no explanation.
   */
  const [filled, setFilled] = useState<boolean | null>(null);

  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col items-center justify-center bg-black",
        // Clear of the mobile bottom nav on the standalone /reels route, the
        // same allowance ReelCard makes for its own chrome.
        variant === "page" && "pb-16 lg:pb-0",
      )}
    >
      {/*
        The label, and it is not decoration.
        A full-screen unit inside a content deck is, without one, an ad
        disguised as editorial — a dark pattern, and specifically an AdSense
        policy violation on a site that has already been refused three times.
        Positioned in the safe area so it clears the status bar in the installed
        PWA, where the deck draws edge-to-edge under it.
      */}
      {/*
        🔴 The "SPONSORED" pill is GONE (owner, 2026-08-30: "remove the sponsored
        logo … make it fill like a reels video").

        It was a SECOND label: `ExoClickUnit` already draws its own "Ad" badge on
        the video, so the two stacked on top of each other in the top-left corner
        and read as a rendering bug rather than a disclosure. Removing this one
        keeps the deck looking like the deck while the ad stays labelled — which
        is how TikTok and Instagram mark a sponsored clip, and keeps the AdSense
        disclosure requirement satisfied.
      */}

      {/*
        `fullBleed` — this placement owns a whole 9:16 screen, so the unit should
        use all of it rather than the constrained in-page column the other four
        ExoClick placements sit in.
      */}
      <div className="flex h-full w-full items-center justify-center">
        <AdSlot
          zone="reels_interstitial"
          fullBleed
          dismissible={false}
          className="h-full w-full"
          onResolved={setFilled}
        />
      </div>

      {/*
        The dead-end guard. If nothing filled, the slide says so plainly and
        points at the way out, rather than leaving a viewer stranded on a black
        screen wondering whether the app broke. Only ever shown AFTER the slot
        has answered — a "nothing here" message flashed while an ad was still
        arriving would be worse than the silence it replaces.
      */}
      {filled === false ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center">
          <p className="text-sm font-semibold text-white/70">Nothing to show here</p>
          <p className="flex items-center gap-1.5 text-xs text-white/45">
            <ChevronUp aria-hidden className="h-3.5 w-3.5" />
            Swipe up for the next reel
          </p>
        </div>
      ) : null}
    </div>
  );
}
