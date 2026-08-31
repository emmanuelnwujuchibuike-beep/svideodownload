"use client";

import { useEffect, useRef, useState } from "react";

import { Portal } from "@/components/ui/portal";
import { StreakFlameMark } from "@/features/streaks/streak-flame-mark";
import { LOW_POWER_FX_CLASS, useLowPowerFx } from "@/features/streaks/use-low-power-fx";
import { claimStreakSound, markStreakCelebrated } from "@/features/streaks/use-streak";
import { hapticPattern } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import type { StreakTier } from "@/lib/streaks/tiers";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE MILESTONE CEREMONY — a week is not a bigger day
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-08-31: reaching 7 days "should have a substantially different
 * celebration from normal daily streaks ... The user should immediately
 * understand: I achieved something special." Explicitly NOT the ordinary
 * celebration with more particles and a bigger flame.
 *
 * So this is a separate component, not a prop on the daily one. They share the
 * flame, the tier table and the once-a-day server gate, and nothing else: the
 * daily celebration is a 2.6s flash of encouragement, and this is a ~3.5s
 * choreographed sequence with its own environment, emblem and typography.
 *
 * ── Milestone-agnostic by construction (§11) ─────────────────────────────────
 *
 * It takes a `tier`, never the number 7. Reaching 14, 30, 100 or 365 renders
 * the identical ceremony in that tier's colours with that tier's name, and a
 * future 60- or 90-day milestone needs a row in `STREAK_TIERS` and nothing
 * here. `milestoneFor()` decides WHEN; this decides only HOW.
 *
 * ── 🔴 It cannot fire twice ──────────────────────────────────────────────────
 *
 * It never decides to appear. `StreakTracker` mounts it only when the SERVER
 * said `shouldCelebrate`, and `markStreakCelebrated()` fires on the first frame
 * — so a refresh, a second tab, a route change, a remount, a PWA relaunch or a
 * sign-in all come back `shouldCelebrate: false` and mount nothing. §12 asked
 * for a stored celebration state tied to the transition; that already existed
 * and is reused rather than duplicated with a localStorage flag, which would
 * replay after a storage clear and can be edited to replay forever.
 *
 * ── The choreography (§7), and why the numbers are here ──────────────────────
 *
 * The timings live in ONE table because the sequence is the feature. Split
 * across six CSS files they drift, and a ceremony whose beats have drifted
 * reads as jank rather than as direction. CSS owns the easing; this owns only
 * WHEN each layer is told to start, so nothing runs on the main thread per
 * frame.
 */

/** The beats, in ms from mount. §7's storyboard, in one place. */
const BEAT = {
  /** Ambient light appears; the environment takes over the screen. */
  environment: 0,
  /** The ring forms and particles begin gathering inward. */
  ring: 300,
  /** The emblem emerges from the dark and settles on its spring. */
  emblem: 700,
  /** The number arrives — the visual centrepiece. */
  number: 950,
  /** The rank name, then the sentence. */
  title: 1250,
  caption: 1500,
  /** Everything holds still and is allowed to breathe. */
  hold: 1750,
  /** The exit begins; nothing snaps shut. */
  exit: 3100,
  /** Unmount, after the exit transition has run. */
  done: 3700,
} as const;

/**
 * A distinctive but restrained pattern (§17) — two short taps and a longer
 * settle, so a milestone is felt as different from the daily single tick
 * without becoming a buzz. `hapticPattern` already no-ops when the member has
 * haptics off and on every device without the Vibration API.
 */
const MILESTONE_HAPTIC = [18, 60, 18, 60, 42];

/**
 * 🔴 THE CEREMONY IS CHAMPAGNE, THE EMBLEM KEEPS ITS RANK.
 *
 * §5 and §11 are explicit that the milestone celebration is lit in "elegant
 * gold/champagne illumination" — the 7-day one especially. Keying the whole
 * ceremony to the TIER accent instead produced an entirely blue screen at day
 * 7 (verified in a screenshot before this was fixed), which is a bigger version
 * of the ordinary streak rather than the achievement ceremony that was asked
 * for.
 *
 * So the two are separated: the ENVIRONMENT — ring, halo, motes, rays and the
 * numeral-s metal — is champagne on every milestone, and the FLAME keeps its
 * own tier colours (blue at 7, violet at 30, gold at 100). That is also what
 * §5 means by "Gold should be used as an accent, not as a dominant flat
 * color": the champagne is the light in the room, and the flame is the thing
 * being lit.
 *
 * A happy side effect: the emblem stays recognisably the same flame the member
 * will see on their chip tomorrow, so the ceremony and the badge agree.
 */
const CEREMONY_ACCENT = "#E3B341";
const CEREMONY_GLOW = "rgb(227 179 65 / 0.5)";

/** Fine drifting motes. Twelve is enough to read as atmosphere; more is smoke. */
const MOTES = Array.from({ length: 12 }, (_, i) => i);

export function StreakMilestoneCelebration({
  streak,
  tier,
  onDone,
}: {
  streak: number;
  tier: StreakTier;
  onDone: () => void;
}) {
  /* Same decision the flame mark uses — see use-low-power-fx.ts. */
  const lite = useLowPowerFx();
  const [leaving, setLeaving] = useState(false);
  const marked = useRef(false);
  const dismissed = useRef(false);

  /*
    One dismissal path for the timer, the tap and the Escape key, so a viewer
    who leaves early cannot race the scheduled exit into calling `onDone` twice
    (which would unmount, then set state on an unmounted parent).
  */
  const dismiss = useRef(() => {});
  dismiss.current = () => {
    if (dismissed.current) return;
    dismissed.current = true;
    setLeaving(true);
    window.setTimeout(onDone, 420);
  };

  useEffect(() => {
    if (!marked.current) {
      marked.current = true;
      // Claim the day on the first frame, not on dismiss: someone who navigates
      // away mid-ceremony must not be shown it again on the next page.
      void markStreakCelebrated();
      /*
        The milestone cue, not the daily one — richer arrangement at a LOWER
        peak level (§17). The claim is still taken so the hero chip cannot also
        make a noise for the same increment; see the note in the chip for why it
        yields this moment rather than racing for it.
      */
      if (claimStreakSound(streak)) playSound("streak-milestone");
      hapticPattern(MILESTONE_HAPTIC);
    }

    /*
      🔴 ONE timer, not one per beat.

      The beats are CSS `animation-delay`s keyed to the BEAT table below, so the
      sequence runs entirely on the compositor. An earlier version advanced a
      `phase` integer through six setState calls to drive the same thing — six
      React re-renders of a full-screen overlay, during the 3.5 seconds it is
      meant to look effortless, for a value the CSS never needed. The only thing
      JavaScript still owns here is when the ceremony ENDS.
    */
    const timers = [setTimeout(() => dismiss.current(), BEAT.exit)];

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss.current();
    };
    document.addEventListener("keydown", onKey);

    /* §18 — the page behind must not scroll under the ceremony. */
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      timers.forEach(clearTimeout);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
    // `streak` and `tier` are fixed for this overlay's whole life — the tracker
    // sets them once and unmounts on done.
  }, [streak, tier]);

  return (
    <Portal>
      <div
        /*
          `role="status"` + polite, exactly like the daily celebration: a screen
          reader hears the achievement once, and focus is never moved or trapped
          (§20 — the user must be able to keep using Frenzsave). Escape and a tap
          both dismiss, and it dismisses itself regardless.
        */
        role="status"
        aria-live="polite"
        aria-label={`${streak} day streak. ${tier.label}.`}
        onClick={() => dismiss.current()}
        style={{ ["--ms-accent" as string]: CEREMONY_ACCENT, ["--ms-glow" as string]: CEREMONY_GLOW }}
        className={`streak-ms ${lite ? LOW_POWER_FX_CLASS : ""} fixed inset-0 z-[130] flex flex-col items-center justify-center px-6 ${
          leaving ? "streak-ms-leaving" : ""
        }`}
      >
        {/* ── The environment (§5). Layered radial lights rather than a flat
            wash, so the screen has depth before anything else arrives. Static
            gradients: nothing here animates per frame. */}
        <span aria-hidden className="streak-ms-env pointer-events-none absolute inset-0" />
        <span aria-hidden className="streak-ms-rays pointer-events-none absolute inset-0" />

        {/* ── Fine motes drifting toward the centre (§7, 300-700ms). */}
        <span aria-hidden className="streak-ms-motes pointer-events-none absolute inset-0">
          {MOTES.map((i) => (
            <span key={i} className="streak-ms-mote" style={{ ["--i" as string]: i }} />
          ))}
        </span>

        <span aria-hidden className="streak-ms-stage relative flex items-center justify-center">
          {/* The luminous ring that forms around the emblem. */}
          <span className="streak-ms-ring pointer-events-none absolute" />
          <span className="streak-ms-halo pointer-events-none absolute" />
          {/*
            🔴 THE EMBLEM, not the chip's glyph at a larger size (§6). The mark
            carries the tier's own motion — at 7 days that is blue's licking
            flame, at 100 the storm — and the ring around it is what makes it
            read as a milestone emblem rather than a big icon.
          */}
          <span className="streak-ms-emblem relative">
            <StreakFlameMark
              tier={tier}
              className="h-[5.5rem] w-[5.5rem]"
              wrapperClassName="h-[7rem] w-[7rem]"
            />
          </span>
        </span>

        {/*
          🔴 THE NUMBER IS THE CENTREPIECE (§8) — and deliberately NOT the
          typography ordinary streaks use. Metallic gradient, tight tracking,
          a controlled glow, and an entrance that scales and rises a few pixels
          rather than bouncing. §7 is explicit: "Do NOT make the number bounce
          excessively."
        */}
        <p className="streak-ms-number relative mt-2 leading-[0.85]">
          <span className="streak-ms-number-ink">{streak}</span>
        </p>

        <p className="streak-ms-title relative mt-3 text-[13px] font-black uppercase tracking-[0.4em] text-foreground/85">
          Day{streak === 1 ? "" : "s"} streak
        </p>

        {/*
          The rank, then one sentence. §7 asks for "A full week. You're on
          fire." — taken from the tier's own blurb so the 14/30/100-day
          ceremonies read correctly without a second copy deck to maintain.
        */}
        <p className="streak-ms-caption relative mt-2 max-w-[22rem] text-center text-[13.5px] font-semibold text-muted-foreground">
          <span className="streak-ms-rank">{tier.label}</span>
          <span className="mt-1 block font-medium">{tier.blurb}</span>
        </p>
      </div>
    </Portal>
  );
}
