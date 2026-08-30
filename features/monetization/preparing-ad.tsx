"use client";

import { AdSlot } from "./ad-slot";

/**
 * The video that plays while a link is being fetched and the file prepared.
 *
 * Owner, 2026-08-30: "make an exoclick video play in background as the file is
 * preparing for more interaction."
 *
 * ── It is a WAITING STATE, not a gate ─────────────────────────────────────────
 *
 * Nothing about the download waits on this. The fetch runs exactly as it did;
 * this only fills the seconds the visitor was already spending looking at a
 * spinner. It unmounts the moment the caller stops being busy, so it can never
 * sit on top of the result the visitor was waiting for — which is the difference
 * between a wait that feels shorter and an ad that feels like a toll.
 *
 * ── Its own file, and not by accident ─────────────────────────────────────────
 *
 * `ad-slots.test.ts` fails any component naming three or more zone ids as string
 * literals, on the rule that a file listing zones is building a second registry.
 * Both paste boxes already name two, so inlining this would have tripped it —
 * and the guard would have been right: this is a placement with its own
 * behaviour, so it belongs in its own component rather than as a third literal
 * in a component about downloading.
 */
export function PreparingAd({
  /** True only while a fetch is genuinely in flight. */
  active,
  className,
}: {
  active: boolean;
  className?: string;
}) {
  if (!active) return null;

  return (
    /*
      `empty:hidden` rather than an `onResolved` latch: the slot is this
      wrapper's ONLY child, so when the zone is unseeded the wrapper is genuinely
      childless and the CSS rule fires. That keeps the margin from rendering as a
      band of dead space above the fetching indicator on a site with no ExoClick
      configured.
    */
    <div className={className ?? "mt-5 w-full empty:hidden"}>
      {/*
        Full-bleed and never dismissible. At this size the video is the point —
        a boxed unit with a caption row would be back to framing an advert, and
        a close button on a thing that removes itself in a few seconds is a
        control with nothing to do.
      */}
      <AdSlot zone="download_preparing" dismissible={false} fullBleed />
    </div>
  );
}
