"use client";

import { useState } from "react";

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
 * That cache is display-only and stamped with the day it was written (see
 * `readDisplayCache`); it is never read as truth, and the server recomputes
 * everything from server time.
 *
 * ── It cannot break the hero ─────────────────────────────────────────────
 * No streak, no data, a failed request, the feature flag off — every one of
 * those renders `null`. The hero is exactly what it was before in all of them.
 */
export function StreakHeroIndicator({ className = "" }: { className?: string }) {
  // `useState(initialiser)` runs during the first render, so the cached number
  // is on screen in the same commit as the rest of the hero — not a frame later.
  const [cached] = useState<number | null>(() => readDisplayCache());
  const { data } = useStreak();

  const streak = data?.currentStreak ?? cached ?? 0;
  if (streak < 1) return null;

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-r from-amber-500/12 to-orange-500/12 px-2.5 py-1 text-[12px] font-bold text-orange-600 ring-1 ring-inset ring-orange-500/25 dark:text-orange-300 dark:ring-orange-400/25 ${className}`}
      /* The accessible name carries the meaning in words, so the streak is
         never communicated by a coloured glyph alone (§22). */
      title={`${streak} day streak`}
    >
      <StreakFlame className="h-[15px] w-[15px]" gradient animated />
      <span aria-hidden>{streak}</span>
      {/* "Day Streak" only where there is room; the number alone below that. */}
      <span aria-hidden className="hidden sm:inline">
        Day Streak
      </span>
      <span className="sr-only">{streak} day streak</span>
    </span>
  );
}
