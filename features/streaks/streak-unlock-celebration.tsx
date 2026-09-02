"use client";

import { useEffect, useRef, useState } from "react";

import { Portal } from "@/components/ui/portal";
import { StreakFlameMark } from "@/features/streaks/streak-flame-mark";
import { LOW_POWER_FX_CLASS, useLowPowerFx } from "@/features/streaks/use-low-power-fx";
import { claimStreakSound, markStreakCelebrated } from "@/features/streaks/use-streak";
import { hapticPattern } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { previousTier, type StreakTier } from "@/lib/streaks/tiers";

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

/** The beats, in ms from mount. The sequence is the feature; it lives in one table. */
const BEAT = {
  /** The rank they arrive with, already lit. */
  from: 260,
  /** The ring forms and the sweep crosses — the moment of change. */
  turn: 780,
  /** The new flame has fully ignited; the words may start. */
  lit: 1300,
} as const;

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
const CEREMONY_ACCENT = "#E3B341";
const CEREMONY_GLOW = "rgb(227 179 65 / 0.5)";

/** Enough to read as atmosphere. More is smoke; this is why it barely scales. */
const MOTES = Array.from({ length: 12 }, (_, i) => i);

export function StreakUnlockCelebration({
  streak,
  tier,
  onViewGallery,
  onDone,
}: {
  streak: number;
  tier: StreakTier;
  /** "VIEW FLAME GALLERY" — the tracker owns the handoff, not this overlay. */
  onViewGallery: () => void;
  onDone: () => void;
}) {
  const lite = useLowPowerFx();
  const [leaving, setLeaving] = useState(false);
  /** Drives only the two-flame crossover; everything else is CSS delays. */
  const [turned, setTurned] = useState(false);
  const marked = useRef(false);
  const dismissed = useRef(false);
  const panel = useRef<HTMLDivElement | null>(null);
  const continueBtn = useRef<HTMLButtonElement | null>(null);
  const restoreTo = useRef<Element | null>(null);

  const from = previousTier(tier);
  const compact = tier.ceremony <= 1;

  /*
    One dismissal path for the button, the backdrop and Escape, so none of them
    can race another into calling `onDone` twice (which would unmount, then set
    state on an unmounted parent).
  */
  const dismiss = useRef<(then?: () => void) => void>(() => {});
  dismiss.current = (then?: () => void) => {
    if (dismissed.current) return;
    dismissed.current = true;
    setLeaving(true);
    window.setTimeout(() => {
      onDone();
      then?.();
    }, 380);
  };

  useEffect(() => {
    if (!marked.current) {
      marked.current = true;
      /*
        Claim the day on the first frame, not on dismiss: someone who navigates
        away mid-ceremony must not be shown it again on the next page.
      */
      void markStreakCelebrated();
      /*
        The claim is taken so the hero chip cannot also make a noise for the
        same increment. `playSound` still honours the master sound switch and
        stays silent until an AudioContext has been unlocked by a real gesture,
        so this can never be what makes a phone blurt in a quiet room.
      */
      if (claimStreakSound(streak)) playSound("streak-milestone");
      hapticPattern(HAPTIC[tier.ceremony] ?? HAPTIC[4]!);
    }

    restoreTo.current = document.activeElement;
    // CONTINUE is the escape hatch, so a keyboard or switch user's first
    // Tab-free action is always "get out".
    continueBtn.current?.focus();

    /* The ONE piece of state JavaScript still owns: the flame crossover. Every
       other beat is a CSS `animation-delay`, so the sequence runs on the
       compositor rather than through six React re-renders of a full-screen
       overlay during the 2 seconds it is meant to look effortless. */
    const turn = window.setTimeout(() => setTurned(true), BEAT.turn);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        dismiss.current();
      }
    };
    document.addEventListener("keydown", onKey);

    /* The page behind must not scroll under the ceremony. Restored to whatever
       it WAS, so this cannot clobber another overlay's lock if the two overlap. */
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.clearTimeout(turn);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      if (panel.current?.contains(document.activeElement)) {
        (restoreTo.current as HTMLElement | null)?.focus?.();
      }
    };
    // `streak` and `tier` are fixed for this overlay's whole life — the tracker
    // sets them once and unmounts on done.
  }, [streak, tier]);

  return (
    <Portal>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="streak-unlock-title"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) dismiss.current();
        }}
        style={{
          ["--ms-accent" as string]: CEREMONY_ACCENT,
          ["--ms-glow" as string]: CEREMONY_GLOW,
          /* One number the stylesheet scales everything from (§4). */
          ["--ms-i" as string]: String(tier.ceremony),
        }}
        data-ceremony={tier.ceremony}
        className={`streak-ms ${compact ? "streak-ms-compact" : ""} ${
          lite ? LOW_POWER_FX_CLASS : ""
        } fixed inset-0 z-[130] flex flex-col items-center justify-center px-6 ${
          leaving ? "streak-ms-leaving" : ""
        }`}
      >
        {/* ── The environment. Layered radial light rather than a flat wash, so
            the screen has depth before anything else arrives. Static
            gradients: nothing here animates per frame. */}
        <span aria-hidden className="streak-ms-env pointer-events-none absolute inset-0" />
        {!compact ? (
          <span aria-hidden className="streak-ms-rays pointer-events-none absolute inset-0" />
        ) : null}

        {/* Fine motes drifting inward. Deliberately near-constant across ranks. */}
        {!compact ? (
          <span aria-hidden className="streak-ms-motes pointer-events-none absolute inset-0">
            {MOTES.map((i) => (
              <span key={i} className="streak-ms-mote" style={{ ["--i" as string]: i }} />
            ))}
          </span>
        ) : null}

        <div ref={panel} className="streak-ms-panel relative flex flex-col items-center">
          {/*
            🔴 THE EYEBROW LEADS (§3). The member has to know WHAT happened
            before they can read which rank it was — "NEW FLAME UNLOCKED" is the
            sentence that turns a pretty screen into an achievement.
          */}
          <p className="streak-ms-eyebrow">New flame unlocked</p>

          <span aria-hidden className="streak-ms-stage relative flex items-center justify-center">
            <span className="streak-ms-ring pointer-events-none absolute" />
            <span className="streak-ms-halo pointer-events-none absolute" />

            {/*
              ── THE TRANSFORMATION (§3, §8) ──────────────────────────────────
              The rank they arrived with, brightening as it goes, and the rank
              they just earned igniting through it. Both are the SAME mark
              component the chip and the gallery use, so the flame in the
              ceremony is recognisably the flame they will see tomorrow.
            */}
            {from ? (
              <span className={`streak-ms-prev absolute ${turned ? "is-out" : ""}`}>
                <StreakFlameMark
                  tier={from}
                  effects={false}
                  className="h-[4.75rem] w-[4.75rem]"
                  wrapperClassName="h-[6rem] w-[6rem]"
                />
              </span>
            ) : null}

            <span className={`streak-ms-emblem relative ${from && !turned ? "is-waiting" : ""}`}>
              <StreakFlameMark
                tier={tier}
                className="h-[5.5rem] w-[5.5rem]"
                wrapperClassName="h-[7rem] w-[7rem]"
              />
            </span>

            {/* A single light sweep at the crossover. One element, one pass —
                the "light sweep" §3 asks for, not a shimmer loop. */}
            <span className="streak-ms-sweep pointer-events-none absolute" />
          </span>

          {/*
            🔴 THE RANK IS THE HEADLINE, THE NUMBER SUPPORTS IT. This inverts
            the old ceremony, which led with a giant numeral: at an UNLOCK the
            news is which flame you now own, and "7" alone does not say that.
          */}
          <h2 id="streak-unlock-title" className="streak-ms-rank">
            {tier.label}
          </h2>
          <p className="streak-ms-days">
            {streak} {streak === 1 ? "day" : "days"}
          </p>

          {/*
            The per-rank line (§4 gives a different one for each), then the
            constant that names what just happened (§3/§8). Two lines, because
            the owner's copy has two jobs: congratulate, and explain.
          */}
          <p className="streak-ms-line">{tier.unlockLine}</p>
          <p className="streak-ms-sub">
            {tier.unlockNote ?? "Your consistency unlocked a new flame."}
          </p>

          <div className="streak-ms-actions">
            <button
              type="button"
              onClick={() => dismiss.current(onViewGallery)}
              className="streak-ms-cta"
            >
              View flame gallery
            </button>
            <button
              ref={continueBtn}
              type="button"
              onClick={() => dismiss.current()}
              className="streak-ms-continue"
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
