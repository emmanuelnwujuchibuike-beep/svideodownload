"use client";

import { useEffect, useRef, useState } from "react";

import { StreakFlame } from "@/features/streaks/streak-flame";
import { readDisplayCache, useStreak } from "@/features/streaks/use-streak";

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
  if (streak < 1) return null;

  const label = `${streak} day streak`;
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
        className="srch-press inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-r from-amber-500/12 to-orange-500/12 px-2.5 py-1 text-[12px] font-bold text-orange-600 ring-1 ring-inset ring-orange-500/25 dark:text-orange-300 dark:ring-orange-400/25"
      >
        <StreakFlame className="h-[15px] w-[15px]" gradient animated />
        <span aria-hidden>{streak}</span>
        {/* "Day Streak" only where there is room; the number alone below that. */}
        <span aria-hidden className="hidden sm:inline">
          Day Streak
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
              🎉 {streak} day{streak === 1 ? "" : "s"} streak!
            </span>
            <span className="mt-0.5 block text-[11.5px] font-medium text-background/70">
              {streak === 1
                ? "You started today — come back tomorrow to keep it going."
                : `${streak} days in a row on Frenzsave. Keep it alive!`}
            </span>
          </>
        ) : null}
      </span>
    </span>
  );
}
