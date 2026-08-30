"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

import { AdSlot } from "./ad-slot";
import { useShowAds } from "./use-show-ads";

/**
 * A bold, centered ad shown directly above a freshly-fetched result for ~5
 * seconds, then it auto-dismisses. Closable early. Non-blocking.
 *
 * ── The empty-box bug this was reported for ───────────────────────────────────
 *
 * This component used to claim it was "hidden when no `result_top` ad is
 * configured (the slot renders nothing)". The slot did render nothing — and the
 * CHROME AROUND IT still rendered: a bordered, gradient card with a "Sponsored"
 * label and a close button, wrapped around nothing, above every download result,
 * for five seconds. `result_top` has never had an ad seeded, so that is what
 * every visitor saw. The comment described the intent and the code did not
 * implement it.
 *
 * The card now reveals only once the slot reports a real ad, via `onResolved`.
 *
 * ── Why not `empty:hidden`, which fixed this on the landing page ──────────────
 *
 * That utility only matches an element with NO child nodes. Here the label and
 * the close button are siblings of the slot inside the same card, so the card is
 * never childless and the rule can never fire. The landing page's wrapper had
 * nothing but the slot in it, which is why it worked there and why the fix did
 * not generalise.
 *
 * ── One slot, one fetch, one position in the tree ─────────────────────────────
 *
 * The slot performs the request, so it cannot be gated on the answer to its own
 * request. It is therefore mounted unconditionally and in a FIXED position, with
 * only the wrapper's visibility toggled. Rendering it in one branch and again in
 * another would remount it — two requests, and for a self-injecting `pop` script
 * a teardown of markup that had already run.
 *
 * The framer-motion entrance was removed rather than reworked: keeping it would
 * have meant animating height (a layout property the performance gate excludes)
 * or moving the slot between subtrees, and an entrance animation is not worth
 * either.
 */
export function FetchedAd() {
  const { showAds } = useShowAds();
  /*
    Three states, not two. `null` is "the slot has not answered yet" and renders
    nothing — starting at `true` is precisely what produced the empty box, and
    it is not the same as a resolved-empty zone.
  */
  const [hasAd, setHasAd] = useState<boolean | null>(null);

  /*
    ── The auto-dismiss is GONE ────────────────────────────────────────────────

    It used to hide the strip five seconds after `onResolved` fired. That sounds
    safe and is not: `onResolved` reports that an ad ROW was found, which for a
    `display` unit happens well before the iframe has fetched and painted the
    creative. On a slow connection the sequence was — row resolves, timer
    starts, four seconds of iframe loading, ad finally paints, one second later
    it vanishes. Exactly the reported "shows for 1 sec and goes out without
    clicking the X".

    Chasing it with a longer timer, or starting it on iframe `load`, would only
    move the race. The strip has its own close button, sits above the result
    rather than over it, and costs the visitor nothing by staying — so it stays
    until they dismiss it.
  */

  if (!showAds) return null;

  const show = hasAd === true;

  return (
    <div
      /*
        🔴 FULL-BLEED, NO CHROME (owner, 2026-08-30: "i dont like the video
        wrapper, i want it to be full width like a platform reels … remove those
        artificial sponsored, background and X, it should reach full width of the
        download result section, so users can enjoy watching it").

        Gone: the `max-w-2xl` cap, the bordered gradient card, the padding, the
        "SPONSORED" caption row and the close button. All of it was framing built
        for a small banner, and it made a full-motion video look like a boxed
        advert bolted onto the page instead of something worth watching.

        The unit now spans the result section exactly as a reel does. Its own
        controls live ON the video — a small "Ad" badge top-left and the mute
        toggle bottom-right — which is how TikTok and Instagram present a
        sponsored clip, and is why the disclosure is not lost with the caption.
      */
      className={cn("relative mt-6 w-full", !show && "hidden")}
      // `hidden` rather than unmounting: the slot inside must keep its position
      // in the tree so it is never re-requested. Hidden elements are out of the
      // layout entirely, so this reserves no space.
      aria-hidden={!show}
    >
      {/*
        `fullBleed` — the video sizes itself to the section's width and its own
        aspect, rather than being capped into a narrow column.

        Not dismissible, by explicit instruction: no X here, and `dismissible`
        stays false so `AdSlot` cannot draw one either.
      */}
      <AdSlot zone="result_top" dismissible={false} fullBleed onResolved={setHasAd} />
    </div>
  );
}
