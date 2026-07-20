"use client";

import { useState } from "react";

import type { AdZone } from "@/lib/monetization/types";
import { cn } from "@/lib/utils";

import { AdSlot } from "./ad-slot";
import { useShowAds } from "./use-show-ads";

/**
 * The shared frame for an in-page ad placement.
 *
 * ── One component so every placement looks like the same product ──────────────
 *
 * The brief was for ads that read as part of the design rather than as things
 * pasted on top of it — the SofaScore model, where a unit sits on a solid card
 * in the page's own rhythm, with a small label, and no dismiss control. Doing
 * that per call site is how the home page and the downloader pages end up with
 * two different-looking "premium" treatments, so the treatment lives here and
 * the call sites choose only a placement and a width.
 *
 * ── It renders NOTHING until the slot says there is an ad ─────────────────────
 *
 * This is the whole reason the component exists rather than a `className`.
 * `AdSlot` returns null for an unseeded zone, and a card, a label and padding
 * around null is the "empty white space" that was reported. Seven of the eight
 * zones were unseeded when this was written, so the empty case is the NORMAL
 * case and has to be the default state.
 *
 * ── The label is deliberate, not decoration ───────────────────────────────────
 *
 * A unit styled to belong to the page is, without a label, a unit disguised as
 * editorial content. That is a dark pattern and, for AdSense specifically, a
 * policy violation. "Sponsored" is the smallest honest thing that keeps the
 * placement clearly identifiable while still looking designed.
 */
export function AdSurface({
  zone,
  className,
  /** Constrains the card. Match it to the content column it sits under. */
  maxWidth = "max-w-2xl",
  label = "Sponsored",
}: {
  zone: AdZone;
  className?: string;
  maxWidth?: string;
  label?: string | null;
}) {
  const { showAds, ready } = useShowAds();
  const [hasAd, setHasAd] = useState<boolean | null>(null);

  // `ready` guards the premium check: rendering before the plan resolves would
  // flash an ad frame at a paying user.
  if (!ready || !showAds) return null;

  return (
    /*
      The card SHRINKS TO THE AD rather than filling a fixed column.

      `maxWidth` was applied as a width, so a 468×60 leaderboard sat inside a
      `max-w-2xl` card with wide bands of empty card either side of it — the ad
      looked lost in a box built for something else. `w-fit` makes the card hug
      whatever the unit turns out to be, and `maxWidth` becomes a ceiling rather
      than a target, so an oversized or responsive unit is still constrained to
      the content column.
    */
    <div
      className={cn(
        "mx-auto w-fit max-w-full",
        maxWidth,
        hasAd !== true && "hidden",
        className,
      )}
      aria-hidden={hasAd !== true}
    >
      <div className="rounded-2xl border border-border/60 bg-card p-3 shadow-soft">
        {label ? (
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
            {label}
          </p>
        ) : null}
        {/*
          The slot keeps a fixed position in the tree and the WRAPPER is hidden,
          rather than the slot being conditionally mounted. Mounting it only
          after it answers is impossible — it is the thing that asks — and
          moving it between branches would remount it into a second request.
        */}
        <AdSlot zone={zone} dismissible={false} onResolved={setHasAd} />
      </div>
    </div>
  );
}
