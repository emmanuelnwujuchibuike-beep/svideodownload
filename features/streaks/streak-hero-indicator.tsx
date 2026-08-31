"use client";

import { useEffect, useRef, useState } from "react";

import { playSound } from "@/lib/notifications/sound-fx";
import { StreakFlame } from "@/features/streaks/streak-flame";
import { claimStreakSound, readDisplayCache, useStreak } from "@/features/streaks/use-streak";
import { nextTier, tierFor } from "@/lib/streaks/tiers";

/**
 * The persistent hero chip: 🔥 12, or 🔥 12 Day Streak where there is room.
 *
 * Rendered inside `DownloadsHero`, which is the shared top section of BOTH the
 * landing page and `/downloads` — so the brief's two hero placements are one
 * integration point rather than two copies drifting apart.
 *
 * ── 🔴 ZERO CLS, WHICH IS WHY IT PAINTS FROM A CACHE FIRST ───────────────
 * The landing page is statically generated and has a 1.6s LCP target. A chip
 * that appears when a fetch resolves would reflow the pill row it sits in —
 * after paint, unprompted, which is exactly the layout shift CLS measures.
 *
 * So a returning visitor's chip renders in the FIRST client render, from a
 * localStorage display cache written on the last visit, and the network
 * response then only ever corrects the number in place. A first-time visitor
 * has no cache, renders nothing, and gets their chip on the next visit — no
 * shift either way.
 *
 * ── Tap to see the streak ────────────────────────────────────────────────
 * Owner (2026-08-24): tapping the flame shows the streak for ~2s. It is a
 * popover anchored to the chip, NOT a dialog — it steals no focus, traps
 * nothing, blocks nothing, and dismisses itself. Absolutely positioned, so
 * showing it cannot move the hero.
 */

/** Long enough to read, short enough to stay out of the way. */
const REVEAL_MS = 2000;

/**
 * Where the sparkle ticks sit, in degrees around the pill.
 *
 * Eight, and deliberately NOT evenly spaced: the four diagonals are the corners
 * of a rounded pill, where a tick has room to breathe, and the four axes are
 * pulled slightly off so the burst reads as hand-drawn rather than as a compass
 * rose. Even spacing looked like a loading spinner.
 */
const SPARK_ANGLES = [18, 52, 128, 162, 198, 232, 308, 342] as const;

export function StreakHeroIndicator({ className = "" }: { className?: string }) {
  // `useState(initialiser)` runs during the first render, so the cached number
  // is on screen in the same commit as the rest of the hero — not a frame later.
  const [cached] = useState<number | null>(() => readDisplayCache());
  const { data } = useStreak();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const streak = data?.currentStreak ?? cached ?? 0;

  /*
    ═════════════════════════════════════════════════════════════════════════
     THE INCREMENT IS THE MOMENT (owner, 2026-08-25)
    ═════════════════════════════════════════════════════════════════════════

    "the streak animation doesnt animate when it increase, it should bounce and
    move and feel alive like celebration, with sound."

    The number used to just SWAP. `recordStreakActivity()` publishes the new
    state, every consumer re-renders, and the one thing the visitor came back
    for changed silently — a 6 that becomes a 7 between two frames is not an
    event, it is a typo.

    ── What counts as an increase, and what deliberately does not ───────────

    Only a rise from a number that was ALREADY ON SCREEN. `prev` starts at the
    display cache, so:

     • cache 6 → server 7  ⇒ celebrate. The real case.
     • no cache → server 7 ⇒ SILENT. A first paint is not an increment; the chip
       appearing at all is already the news, and bouncing something the instant
       it mounts reads as a glitch.
     • server 7 → server 7 ⇒ silent (a refetch, not an increment).
     • any decrease ⇒ silent, and `prev` still follows it down, so a broken and
       rebuilt streak celebrates properly next time.

    ── Why a ref and not state for `prev` ───────────────────────────────────

    Writing it during render would tear under StrictMode's double-invoke and
    under concurrent re-renders; the comparison happens in an effect, which is
    the only place a "what changed since last commit" question has an answer.
  */
  const prev = useRef<number | null>(cached);
  const [pop, setPop] = useState(false);

  useEffect(() => {
    const before = prev.current;
    prev.current = streak;
    if (before === null || streak <= before || streak < 1) return;

    setPop(true);
    /*
      One claim for the whole increment (see `claimStreakSound`). On the day the
      full-screen celebration also runs, exactly one of the two makes a noise —
      and `playSound` itself still honours the master sound switch and stays
      silent until an AudioContext has been unlocked by a real gesture, so this
      can never be what makes a phone blurt in a quiet room.
    */
    if (claimStreakSound(streak)) playSound("streak");

    // Matches the CSS duration below. Cleared on unmount so a visitor who
    // navigates mid-bounce leaves no timer behind.
    const t = setTimeout(() => setPop(false), 1100);
    return () => clearTimeout(t);
  }, [streak]);

  /*
    🔴 TWO DAYS, NOT ONE (owner, 2026-08-30: "make the streak badge when users
    reach 2 days streaks to be like this image"). A single day is a visit, not a
    streak, and a "1 day streak" badge on someone's first session devalues the
    thing for everyone who actually has one. `tierFor` returns null below the
    threshold, so the rule lives with the tiers rather than as a loose `< 1`.
  */
  const tier = tierFor(streak);
  if (!tier) return null;

  const label = `${streak} day streak — ${tier.label}`;
  const upcoming = nextTier(streak);
  const reveal = () => {
    setOpen(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), REVEAL_MS);
  };

  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={reveal}
        aria-label={label}
        aria-expanded={open}
        /*
          🔴 RAISED, NOT FLAT (owner, 2026-08-30: "i want it more 3d like it is
          in my screenshot").

          Four layers do the depth, and each is doing a specific job — a single
          `shadow-lg` reads as a floating sticker, not as a moulded pill:

            • `streak-chip-3d`  a two-stop drop shadow (tight contact + soft
                                ambient) plus an INSET top highlight and an inset
                                bottom shade. The inset pair is what makes the
                                surface look curved rather than merely lifted.
            • the tier gradient sits under a white-to-transparent sheen, so the
                                top of the pill catches light.
            • `ring-inset`      keeps the rim crisp against the sheen.
            • `py-1.5`/`px-3`   a little more body — a 3D object needs thickness,
                                and the previous padding made it a decal.

          All static CSS. No JS, no extra element, no layout change beyond the
          padding — this is on the landing's LCP path.
        */
        className={`srch-press streak-chip streak-chip-3d relative inline-flex shrink-0 items-center gap-1.5 rounded-full ${tier.fill} px-3 py-1.5 text-[12px] font-bold ${tier.text} ring-1 ring-inset ${tier.ring} ${
          pop ? "streak-chip-pop" : ""
        }`}
      >
        {/* The light catch. Purely a surface, so it sits above the fill and
            below the content, and never intercepts the tap. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-b from-white/55 via-white/10 to-transparent dark:from-white/20 dark:via-white/5"
        />
        {/* The ring only exists during the bounce. Rendered conditionally rather
            than parked at `opacity-0`, because an always-present absolutely
            positioned sibling is a compositing layer this chip carries on every
            page that shows it, for one second a day. */}
        {pop ? (
          <span
            aria-hidden
            className={`streak-chip-ring pointer-events-none absolute inset-0 rounded-full ring-2 ${tier.ring}`}
          />
        ) : null}
        {/*
          THE SPARKLE BURST (owner, 2026-08-30: the badge should "feel alive").

          Eight ticks radiating from the pill, drawn as one absolutely-positioned
          layer so they add nothing to the chip's own box and cannot shift the
          hero row — the same CLS rule the chip itself obeys.

          They idle at a slow twinkle and go bright on an increment. Purely
          decorative and `aria-hidden`: the streak is already announced by the
          button's label and the popover's `role="status"`.
        */}
        <span aria-hidden className={`streak-sparks pointer-events-none absolute inset-0 ${pop ? "streak-sparks-burst" : ""}`}>
          {SPARK_ANGLES.map((deg) => (
            <span
              key={deg}
              className={`streak-spark ${tier.spark}`}
              style={{ ["--spark-rotate" as string]: `${deg}deg` }}
            />
          ))}
        </span>
        <StreakFlame
          className={`h-[15px] w-[15px] ${pop ? "streak-chip-flame" : ""}`}
          gradient
          animated
          tier={tier}
        />
        <span aria-hidden className={pop ? "streak-chip-count inline-block" : undefined}>
          {streak}
        </span>
        {/*
          🔴 ALWAYS VISIBLE, and uppercase — matching the owner's reference
          screenshot (2026-08-30), which is a PHONE showing the full
          "4 DAY STREAK".

          This was `hidden sm:inline`, so on the exact device in that screenshot
          the label was suppressed and the chip read as a bare "🔥 4". The
          wording is what makes it a streak rather than an unexplained number,
          and it is four short characters wider — the hero row already wraps.
        */}
        <span aria-hidden className="tracking-[0.06em]">
          DAY STREAK
        </span>
      </button>

      {/*
        The reveal. `absolute` + `pointer-events-none`, so it is outside the
        hero's flow and can never shift the H1 above it or swallow a tap on the
        paste box below it. `role="status"` announces it once, politely, without
        moving focus — which is what makes a self-dismissing popover accessible
        rather than a trap.
      */}
      <span
        role="status"
        aria-live="polite"
        className={`pointer-events-none absolute left-1/2 top-full z-30 mt-2 w-max max-w-[16rem] -translate-x-1/2 rounded-2xl bg-foreground px-3 py-2 text-center shadow-[0_10px_30px_-10px_rgba(0,0,0,0.5)] transition-all duration-200 ease-[var(--ease-out)] motion-reduce:transition-none ${
          open ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0"
        }`}
      >
        {open ? (
          <>
            <span className="block text-[14px] font-bold text-background">
              {tier.label} · {streak} days
            </span>
            <span className="mt-0.5 block text-[11.5px] font-medium text-background/70">
              {/*
                The NEXT flame is the reason to come back, so the popover names
                it. Saying "keep it going" asks for the same thing without ever
                telling anyone what they are working toward.
              */}
              {upcoming
                ? `${upcoming.inDays} more ${upcoming.inDays === 1 ? "day" : "days"} unlocks the ${upcoming.tier.label.toLowerCase()} flame.`
                : "The rarest flame there is. Nothing above this one."}
            </span>
          </>
        ) : null}
      </span>
    </span>
  );
}
