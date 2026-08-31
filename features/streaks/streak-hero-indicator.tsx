"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import { playSound } from "@/lib/notifications/sound-fx";
import { StreakFlameMark, chipStormClass } from "@/features/streaks/streak-flame-mark";
import { claimStreakSound, readDisplayCache, useStreak } from "@/features/streaks/use-streak";
import { milestoneFor, tierFor } from "@/lib/streaks/tiers";

/*
  Code-split: the gallery, its six live tier marks and its CSS-heavy panel are
  fetched on the FIRST TAP and never on a page open. The landing page is held to
  a 218 kB first-load ceiling (lib/perf/budget.test.ts) and nothing here is
  needed to paint the chip.
*/
const StreakTiersSheet = dynamic(
  () => import("@/features/streaks/streak-tiers-sheet").then((m) => m.StreakTiersSheet),
  { ssr: false },
);

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
 * ── Tap to open the flame gallery ────────────────────────────────────────
 * Owner (2026-08-31): tapping the chip must show "all the flames and
 * description ... so they can be ecouraged to get it", and the panel
 * "shouldnt close after 3secs" — it stays until the visitor taps around it.
 *
 * That replaces the 2026-08-24 behaviour (a 2s self-dismissing popover showing
 * only the current tier). It was the right object for a glance and the wrong
 * one for a gallery: six flames with a sentence each cannot be read in two
 * seconds, and the popover was `pointer-events-none`, so tapping it could not
 * dismiss it either. See streak-tiers-sheet.tsx.
 */

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
  const anchor = useRef<HTMLButtonElement | null>(null);

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
  /*
    The chip storm is added AFTER mount, never during hydration. Adding it in
    the server render would make the class list differ from the first client
    render on any device where the decision could vary, and a mismatch costs a
    subtree re-render on the landing page. One frame later is free; a mismatch
    is not.
  */
  const [stormReady, setStormReady] = useState(false);
  useEffect(() => setStormReady(true), []);

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
    /*
      🔴 THE CHIP YIELDS THE MILESTONE MOMENT.

      `claimStreakSound` is first-come-first-served on the streak NUMBER, and
      the chip and the ceremony fire off the same response within a few hundred
      ms of each other. Whoever wins the race makes the noise — so on a
      milestone day the chip could take the claim and play the ORDINARY cue,
      leaving the ceremony silent. The whole point of the milestone sound is
      that it plays on the milestone.

      Deciding it from `milestoneFor` rather than by racing is deterministic:
      both sides read the same pure function off the same number, so exactly one
      sound happens and it is always the right one. On a day where the ceremony
      does not mount (the day was already celebrated) the chip is not
      incrementing either — the display cache already holds today-s number — so
      this cannot silently swallow a cue that had nowhere else to come from.
    */
    if (!milestoneFor(streak) && claimStreakSound(streak)) playSound("streak");

    // Matches the CSS duration below. Cleared on unmount so a visitor who
    // navigates mid-bounce leaves no timer behind.
    const t = setTimeout(() => setPop(false), 1100);
    return () => clearTimeout(t);
  }, [streak]);

  /*
    The visibility threshold lives with the tiers, not as a loose `< 1` here —
    `tierFor` returns null below it. It is ONE day: see the note on the `spark`
    tier in lib/streaks/tiers.ts for why raising it removed the badge from
    nearly every anonymous visitor, and why it must not be raised again.
  */
  const tier = tierFor(streak);
  if (!tier) return null;

  const label = `${streak} ${streak === 1 ? "day" : "days"} streak — ${tier.label}. See all flames.`;
  /*
    No measuring and no anchoring any more. The gallery is a centred dialog, so
    the two failed attempts recorded here — centring on a chip that sits at the
    right of the hero row, then anchoring `right-0` until the row WRAPPED and
    the chip moved — are both moot: it is no longer chip-relative at all.
  */

  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        aria-haspopup="dialog"
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
        /*
          The tier's colour is published as a CSS variable so the halo in
          globals.css can use it. Inline rather than a Tailwind class because
          there are six tiers and an interpolated class name is never emitted
          into the CSS — see the note at the top of lib/streaks/tiers.ts.
        */
        style={{ ["--streak-glow" as string]: tier.glow }}
        className={`srch-press streak-chip streak-chip-3d ${chipStormClass(tier, stormReady)} relative inline-flex shrink-0 items-center gap-1.5 overflow-hidden rounded-full ${tier.fill} px-3 py-1.5 text-[12px] font-bold ${tier.text} ring-1 ring-inset ${tier.ring} ${
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
        {/* 🔴 BIGGER (owner, 2026-08-30: "a more bigger fire"). 15px was smaller
            than the text beside it, which made the flame read as punctuation
            rather than as the badge's subject. 20px sits a little above the
            cap height, so the fire leads and the words follow. `-my-0.5` lets
            it grow WITHOUT growing the pill — the hero row is on the landing's
            LCP path and the chip's box must not change height. */}
        {/* 🔴 The MARK, not the bare glyph — the tier's own motion (blue licks,
            purple smoke, gold/black storm) rides with it. The wrapper keeps the
            same 20px box the glyph used to occupy, so the effects paint outside
            it without changing the chip's height. */}
        <StreakFlameMark
          tier={tier}
          className={`-my-0.5 h-[20px] w-[20px] ${pop ? "streak-chip-flame" : ""}`}
          wrapperClassName="h-[20px] w-[20px]"
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
        {/* 🔴 "2 DAYS STREAK", not "2 DAY STREAK" (owner, 2026-08-30). Only a
            streak of exactly one is singular. */}
        <span aria-hidden className="tracking-[0.06em]">
          {streak === 1 ? "DAY STREAK" : "DAYS STREAK"}
        </span>
      </button>

      {/*
        The gallery. Mounted only while open — the sheet is a `next/dynamic`
        chunk, so on a page where nobody taps the chip its bytes are never
        fetched at all, which is what keeps six live tier marks off the
        landing page-s first-load budget.

        It portals itself (see streak-tiers-sheet.tsx): a `fixed inset-0`
        overlay resolves against the nearest TRANSFORMED / FILTERED / BLURRED
        ancestor rather than the viewport, and the hero card carries exactly
        those -- the standing law this project has now hit five times.
      */}
      {open ? <StreakTiersSheet streak={streak} onClose={() => setOpen(false)} /> : null}
    </span>
  );
}
