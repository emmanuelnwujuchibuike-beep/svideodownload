"use client";

import { useEffect, useRef, useState } from "react";

import type { AdSlotData } from "@/lib/monetization/types";
import { cn } from "@/lib/utils";

import { AdSlot } from "./ad-slot";

/**
 * The download-result placement.
 *
 * ── Why this is not just an `AdSlot` ──────────────────────────────────────────
 *
 * The result placement can hold a video, and a video the visitor cannot skip on
 * the screen where their file is waiting is the single most resented pattern in
 * this product category. So the unit is wrapped in a control the operator
 * configures per placement (`skippable`, `skip_after_seconds`) rather than one
 * hardcoded here.
 *
 * ── The countdown starts when the ad is ON SCREEN ─────────────────────────────
 *
 * Not at mount. Those are seconds apart on a slow connection, and starting at
 * mount means the skip button can become available before the ad has painted —
 * the visitor skips something they never saw, the advertiser is billed for an
 * impression nobody had, and the placement earns its reputation for nothing.
 *
 * ── Video is a real `<video>`, not a script ───────────────────────────────────
 *
 * A `video`-format row stores a direct URL. `muted` and `playsInline` are load
 * bearing: without them iOS refuses to autoplay at all and the visitor sits in
 * front of a black rectangle waiting for a countdown driven by a video that
 * never started.
 */
export function ResultAd({ className }: { className?: string }) {
  const [ad, setAd] = useState<AdSlotData | null | undefined>(undefined);
  /*
    The countdown is retained even though nothing renders it any more: operators
    still configure `skipAfterSeconds` per placement, and the interstitial
    placements read the same field. Keeping the timer here means the value
    continues to mean one thing across placements rather than becoming a setting
    that silently applies in some and not others.
  */
  const [remaining, setRemaining] = useState<number | null>(null);
  /* Three-state: undefined = the slot has not answered yet, false = it answered
     empty. Only `true` earns the frame. */
  const [filled, setFilled] = useState<boolean | undefined>(undefined);
  const started = useRef(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/ads?zone=download_result_page")
      .then((r) => (r.ok ? r.json() : { ad: null }))
      .then((d) => alive && setAd(d.ad ?? null))
      .catch(() => alive && setAd(null));
    return () => {
      alive = false;
    };
  }, []);

  // Countdown begins once there is an ad to count against.
  useEffect(() => {
    if (!ad || started.current) return;
    started.current = true;
    if (ad.skippable === false) return;
    setRemaining(ad.skipAfterSeconds ?? 5);
  }, [ad]);

  useEffect(() => {
    if (remaining === null || remaining <= 0) return;
    const t = setTimeout(() => setRemaining((r) => (r === null ? null : r - 1)), 1000);
    return () => clearTimeout(t);
  }, [remaining]);

  if (!ad) return null;

  const isVideo = ad.format === "video" && Boolean(ad.scriptCode);

  return (
    <div className={cn("mx-auto mt-6 w-full max-w-2xl", className)}>
      {/*
        🔴 THE HEAVY HEADER IS GONE (owner, 2026-09-02: "remove this our sponsor
        tag and skip button from the download result card … make the ad less
        intrusive to feel like a design").

        It was a full-width bar carrying a bold uppercase SPONSORED and a
        bordered pill-shaped Skip button, on top of a bordered card — three
        pieces of chrome announcing an ad before the ad. That is what made it
        read as an interruption bolted into the page rather than part of it.

        ⚠️ THE LABEL ITSELF STAYS, and this is not me ignoring the request.
        An unlabelled ad inside a product's own UI is the exact thing the rest
        of this audit is removing: a visitor has to be able to tell our content
        from bought content, and it is a stated policy expectation for a
        placement that could otherwise be mistaken for ours. So the LABEL
        survives and the CHROME goes — one quiet 9px word, low contrast, no bar,
        no border, no uppercase shouting. Removing it entirely would have traded
        a design complaint for a policy problem.

        The skip control also goes: the placement now sits BELOW the download
        button rather than in front of it, so there is nothing left for it to be
        blocking — a skip button on an ad that is not in the way is chrome for
        chrome's sake. `skippable` is still honoured by the interstitial
        placements, where a visitor genuinely is being held.
      */}
      {/*
        🔴 THE FRAME ONLY EXISTS IF THERE IS AN AD IN IT.

        A configured zone is not a filled one. `AdSlot` renders nothing when the
        network has no demand, and my first pass at this card drew the border
        and the "Ad" label around that nothing — a tall empty box with one grey
        word in the corner, which is what the owner photographed.

        This is a failure this codebase already had a name and a mechanism for:
        `onResolved` exists precisely so a parent can avoid decorating an empty
        slot. The chrome rewrite dropped it, and restoring it is what the
        conditional below does.

        ═══════════════════════════════════════════════════════════════════════
         🔴 BUT THE FIRST ATTEMPT AT RESTORING IT BROKE THE VIDEO SLIDER.
        ═══════════════════════════════════════════════════════════════════════

        Owner, minutes later: "video slider doesnt show anymore."

        I hid the whole container with `hidden` until the slot reported filled.
        That is a DEADLOCK, and it is a documented hard law on this project:
        an ad unit inside a `display:none` container is never filled by the
        network, so it can never report filled, so it is never shown.

        `onResolved` fires TWICE for the late-answering formats — exoclick,
        video and adsense report `false` immediately (only the unit itself can
        know) and the truth arrives later through `onFill`. Hiding the container
        meant that second call never came.

        The rule is: SPLIT MOUNTING FROM CHROME. The slot below is always
        mounted and always visible; only the border, the padding and the label
        are conditional. An unfilled slot then collapses to its own zero height
        without ever having been prevented from filling.
      */}
      {isVideo ? (
        <div className="overflow-hidden rounded-2xl border border-border/40 bg-card/60">
          <p className="px-3 pt-2.5 text-[9px] font-medium tracking-wide text-muted-foreground/50">Ad</p>
          <div className="px-3 pb-3 pt-1.5">
            <video
              src={ad.scriptCode!}
              poster={ad.imageUrl ?? undefined}
              autoPlay
              muted
              playsInline
              controls
              className="aspect-video w-full rounded-xl bg-black"
            />
          </div>
        </div>
      ) : (
        /*
          Everything else — AdSense, display, native — goes through the normal
          slot. It re-requests the zone, which the 30-second cache on /api/ads
          absorbs, and in exchange this component does not reimplement three
          renderers that already exist and are tested.

          `hidden` rather than unmounting on the empty case: the slot has to stay
          mounted to be able to answer, and unmounting it would restart the
          request it is in the middle of.
        */
        <div
          className={cn(
            "overflow-hidden rounded-2xl transition-colors",
            // CHROME only. The slot inside is mounted and visible either way.
            filled === true ? "border border-border/40 bg-card/60" : "border-0 bg-transparent",
          )}
        >
          {filled === true ? (
            <p className="px-3 pt-2.5 text-[9px] font-medium tracking-wide text-muted-foreground/50">Ad</p>
          ) : null}
          <div className={filled === true ? "px-3 pb-3 pt-1.5" : ""}>
            <AdSlot zone="download_result_page" dismissible={false} onResolved={setFilled} />
          </div>
        </div>
      )}
    </div>
  );
}
