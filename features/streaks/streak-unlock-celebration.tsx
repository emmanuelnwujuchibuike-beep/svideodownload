"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { StreakFireBurst } from "@/features/streaks/streak-fire-burst";
import { claimStreakSound, markStreakCelebrated } from "@/features/streaks/use-streak";
import { hapticPattern } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import type { StreakTier } from "@/lib/streaks/tiers";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  NEW FLAME UNLOCKED — the only celebration Frenzsave has
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-01: "there shoudnlt be a celebration everyday, only on flame
 * upgrade." This replaces BOTH of the overlays that used to exist — the daily
 * `StreakCelebration` (deleted; it fired on all 365 days) and the milestone
 * ceremony this file grew out of. One moment, six intensities.
 *
 * ── 🔴 IT NEVER DECIDES TO APPEAR ────────────────────────────────────────────
 *
 * `StreakTracker` mounts it only when the SERVER said `shouldCelebrate`, which
 * is now itself gated on `milestoneFor()` — so "is this a flame upgrade?" is
 * answered once, server-side, from server time. `markStreakCelebrated()` fires
 * on the first frame, so a refresh, a second tab, a route change, a remount, a
 * PWA relaunch or a sign-in all come back `shouldCelebrate: false` and mount
 * nothing.
 *
 * ── The transformation is the feature (§3, §8) ───────────────────────────────
 *
 * "The existing flame should glow, brighten and transition into the newly
 * unlocked flame." So the emblem is TWO marks stacked: the rank they had, which
 * brightens and dissolves, and the rank they just earned, igniting through it,
 * with a ring of light expanding behind and a single sweep across at the
 * crossover. At Day 1 there is no previous rank, and `previousTier` returns
 * null — the ignition simply happens on its own, which is the right shape for
 * "your streak has started" without a special case.
 *
 * ── Intensity, not volume (§4) ───────────────────────────────────────────────
 *
 * "The visual intensity should increase with the rarity of the flame. Do not
 * simply add more particles." `tier.ceremony` (1–6) is published as one CSS
 * custom property and the stylesheet scales the LIGHT with it — ring spread,
 * halo, sweep, emblem size, how far the environment reaches. The mote count
 * moves by four across the whole ladder. Day 1 also drops the takeover
 * entirely and renders as a compact card: §4 asks for "small, welcoming", and
 * a first-time anonymous visitor meets this on their first landing-page view.
 *
 * ── 🔴 IT DOES NOT DISMISS ITSELF ANY MORE ───────────────────────────────────
 *
 * The old ceremony auto-exited at 3.1s. It now carries the owner's two CTAs
 * ("VIEW FLAME GALLERY", "CONTINUE"), and an overlay with buttons that vanishes
 * while you are reaching for one is broken. That also changes what it IS: a
 * `role="dialog"` with focus management, not a `role="status"` announcement.
 * Three exits, per the house rule that a user is never trapped — the CONTINUE
 * button, Escape, and the backdrop.
 */


/**
 * Felt, not heard: two short taps and a longer settle, scaled by rank so 365
 * is not identical to day 1. `hapticPattern` already no-ops where the member
 * has haptics off and on every device without the Vibration API.
 */
const HAPTIC: Record<number, number[]> = {
  1: [14],
  2: [16, 60, 30],
  3: [16, 60, 30],
  4: [18, 60, 18, 60, 42],
  5: [18, 55, 18, 55, 18, 55, 54],
  6: [20, 50, 20, 50, 20, 50, 20, 50, 70],
};

/**
 * 🔴 THE CEREMONY IS CHAMPAGNE; THE EMBLEM KEEPS ITS RANK.
 *
 * Keying the whole screen to the tier accent produced an entirely blue screen
 * at day 7 (caught in a screenshot before it shipped) — a bigger version of the
 * ordinary streak, not an achievement. So the ENVIRONMENT is champagne on every
 * unlock and the FLAME keeps its own colours. The champagne is the light in the
 * room; the flame is the thing being lit.
 */

/** Enough to read as atmosphere. More is smoke; this is why it barely scales. */

export function StreakUnlockCelebration({
  streak,
  tier,
  // kept in the signature for the callers; the card-less burst has no gallery button (2026-10-09)
  onViewGallery: _onViewGallery,
  onDone,
  replay = false,
}: {
  streak: number;
  tier: StreakTier;
  /** "VIEW FLAME GALLERY" — the tracker owns the handoff, not this overlay. */
  onViewGallery: () => void;
  onDone: () => void;
  /**
   * Replaying a flame already earned, from the gallery — not a live unlock.
   *
   * The ceremony is identical; what changes is that it claims nothing. See the
   * effect below: the live path spends TODAY, and a look back at an old flame
   * must not do that.
   */
  replay?: boolean;
}) {
  const marked = useRef(false);
  const dismissed = useRef(false);
  /*
    2026-10-09 (owner: "streak celebration from when a user reaches a milestone
    should be shown in the Download page and message page"). The tracker mounts
    this on any page; it WAITS — no claim, no sound, nothing drawn — until the
    member is on the download page or the messages. The check lives here, in
    this lazily loaded chunk, so the always-loaded shell does not grow.
  */
  const pathname = usePathname() ?? "";
  const here = replay || pathname === "/downloads" || pathname.startsWith("/messages");

  /*
    🔴 IT LEAVES ON THE TAP. NO EXIT ANIMATION TO SIT THROUGH.

    Owner, 2026-09-08, twice: "the vignette try frenz ai exit button doesnt click
    and exit immediately, and the streak gallery modal also doesnt exit
    immediately", then "did you fix the streak flame modal exit issue? cause i
    still see it."

    This held `onDone` behind a 380ms leaving animation. For 380ms after the tap
    nothing the member can act on had happened — the overlay was still there and
    still covering the page. On a phone that is indistinguishable from a dead
    button, so you tap again, and the second tap hits `dismissed.current` and is
    swallowed. The animation was the whole complaint.

    Arriving gently is pleasant; leaving slowly is not. Entry keeps its full
    ceremony — that is the part worth watching — and departure is now immediate.
    `leaving` state is gone with it: there is no interval in which to render it.
  */
  const dismiss = useRef<(then?: () => void) => void>(() => {});
  dismiss.current = (then?: () => void) => {
    // Still guarded: the button, the backdrop and Escape share this path, and
    // two of them racing would call `onDone` twice and set state after unmount.
    if (dismissed.current) return;
    dismissed.current = true;
    onDone();
    /*
      Synchronous, so React batches both into ONE commit — `onDone` clears the
      ceremony and `then` opens the gallery in its place. There is never a frame
      with both mounted, which is the other half of what the owner was seeing.
    */
    then?.();
  };

  useEffect(() => {
    if (!here) return;
    if (!marked.current) {
      marked.current = true;
      /*
        🔴 A REPLAY CLAIMS NOTHING (owner, 2026-09-07: a completed flame should
        be replayable "and when clicked, they can see and replay their past
        celebration").

        `markStreakCelebrated()` claims TODAY, so running it from the gallery
        would mean someone who looked back at an old flame silently lost the
        real celebration for the milestone they hit that same day. Likewise
        `claimStreakSound`, which is a once-per-increment claim.

        The ceremony itself is identical — this only skips the two writes that
        say "today has been spent".
      */
      if (!replay) {
        /*
          Claim the day on the first frame, not on dismiss: someone who
          navigates away mid-ceremony must not be shown it again on the next
          page.
        */
        void markStreakCelebrated();
        /*
          The claim is taken so the hero chip cannot also make a noise for the
          same increment. `playSound` still honours the master sound switch and
          stays silent until an AudioContext has been unlocked by a real
          gesture, so this can never be what makes a phone blurt in a quiet
          room.
        */
        if (claimStreakSound(streak)) playSound("streak-milestone");
      }
      /*
        No sound on a replay, deliberately. `claimStreakSound` is a single-slot
        claim keyed on the streak NUMBER, so replaying under any key would
        overwrite a claim the hero chip may not have taken yet and let the same
        milestone sound twice. The haptic carries the moment; the claim stays
        untouched.
      */
      hapticPattern(HAPTIC[tier.ceremony] ?? HAPTIC[4]!);
    }

    // The burst owns its own leaving (a tap, Escape, or by itself after the burst).
    // `streak` and `tier` are fixed for this overlay's whole life — the tracker
    // sets them once and unmounts on done.
  }, [streak, tier, replay, here]);

  /* 2026-10-09 (owner): no card, no words on screen, no buttons — the flame, large, with fire around it. */
  if (!here) return null;
  return <StreakFireBurst tier={tier} label={`New flame unlocked: ${tier.label}, ${streak} ${streak === 1 ? "day" : "days"}`} onDone={() => dismiss.current()} />;
}
