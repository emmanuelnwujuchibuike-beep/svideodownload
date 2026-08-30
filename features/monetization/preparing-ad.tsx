"use client";

import { cn } from "@/lib/utils";

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
  /*
    🔴 MOUNTED ALWAYS, REVEALED WHEN BUSY (owner, 2026-08-30: "the preparing for
    download is not showing too").

    It used to `return null` until `active`, which cannot work: mounting only at
    the moment of the fetch meant the unit still had to resolve its VAST, then
    fetch an MP4 — a round trip plus a video download — while the fetch it was
    filling was already finishing. It unmounted before it could ever paint. The
    zone was serving correctly the whole time (verified live: a real row on
    `download_preparing`), which is why this looked like a missing ad rather than
    a race.

    Now the slot mounts with the page and merely HIDES until the fetch starts, so
    the creative is resolved and buffered in advance — the same "load before the
    link is pasted" the owner asked for on the above-fetch slot.

    `hidden` (display:none) is safe for BUFFERING — `preload="auto"` still pulls
    the file — but it is NOT safe for playback: a display:none element measures
    0x0 and the player's IntersectionObserver never fires. That is the exact
    deadlock this feature hit twice. It works here only because visibility is
    driven by `active`, not by the player's own answer, so nothing is waiting on
    anything.
  */
  return (
    /*
      `empty:hidden` rather than an `onResolved` latch: the slot is this
      wrapper's ONLY child, so when the zone is unseeded the wrapper is genuinely
      childless and the CSS rule fires. That keeps the margin from rendering as a
      band of dead space above the fetching indicator on a site with no ExoClick
      configured.
    */
    <div className={cn(className ?? "mt-5 w-full empty:hidden", !active && "hidden")} aria-hidden={!active}>
      {/*
        Full-bleed and never dismissible. At this size the video is the point —
        a boxed unit with a caption row would be back to framing an advert, and
        a close button on a thing that removes itself in a few seconds is a
        control with nothing to do.
      */}
      <AdSlot zone="download_preparing" dismissible={false} />
    </div>
  );
}
