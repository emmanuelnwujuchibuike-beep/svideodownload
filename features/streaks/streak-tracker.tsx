"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import { recordStreakActivity } from "@/features/streaks/use-streak";
import { milestoneFor } from "@/lib/streaks/tiers";

/**
 * The single place a day's activity is recorded, and the only thing that can
 * raise the celebration. Renders nothing of its own.
 *
 * ── 🔴 ONE CALL PER PAGE OPEN, FROM ONE COMPONENT ────────────────────────
 * Mounted once from `DeferredShell`, which lives in the ROOT layout — so
 * landing, download, wallpapers, feed and profile all credit the same day
 * through the same call, and navigating between them re-runs nothing (the root
 * layout is preserved across client navigation). Recording from each page
 * instead would have meant one request per route change for a value that can
 * only change at local midnight.
 *
 * Multiple tabs still each fire once, which is fine and expected: the SERVER is
 * what makes the credit idempotent (`streak_daily_activity`'s composite primary
 * key), not the client's restraint.
 *
 * ── 🔴 IT CANNOT DELAY ANYTHING ──────────────────────────────────────────
 * DeferredShell mounts two frames after first paint, so this never competes
 * with LCP, hero rendering or PWA startup. The celebration chunk is
 * code-split and only requested when the server has actually said to celebrate
 * — so on 364 days out of 365 its bytes are never fetched at all.
 */

const StreakCelebration = dynamic(
  () => import("@/features/streaks/streak-celebration").then((m) => m.StreakCelebration),
  { ssr: false },
);

/*
  🔴 A SECOND, SEPARATE CHUNK — not a prop on the daily celebration.

  The ceremony carries its own environment, emblem staging and metallic
  typography, and it plays on FIVE days of a member-s life (7, 14, 30, 100,
  365). Bundling it with the daily overlay would mean every ordinary
  celebration downloaded a milestone it will almost never show; splitting it
  means the ceremony-s bytes are fetched on exactly the days it runs.
*/
const StreakMilestoneCelebration = dynamic(
  () =>
    import("@/features/streaks/streak-milestone-celebration").then(
      (m) => m.StreakMilestoneCelebration,
    ),
  { ssr: false },
);

export function StreakTracker() {
  const [celebrate, setCelebrate] = useState<number | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    // React StrictMode double-invokes effects in development; without this the
    // day would be recorded twice (harmless — the server dedupes — but it is a
    // wasted request on every single page open).
    if (ran.current) return;
    ran.current = true;

    let cancelled = false;
    void recordStreakActivity().then((state) => {
      if (cancelled || !state) return;
      // The SERVER decides. This never inspects dates of its own.
      if (state.shouldCelebrate && state.currentStreak >= 2) setCelebrate(state.currentStreak);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (celebrate === null) return null;

  /*
    🔴 THE MILESTONE FORK, and why it is safe to decide from the number alone.

    `milestoneFor` returns a tier only when the streak landed EXACTLY on a
    threshold, and a streak moves one day at a time (a reset goes to 1, never to
    7) — so landing on 7 can only mean the 6 -> 7 transition. Paired with
    `shouldCelebrate`, which the server sets false for the rest of the day the
    moment it is claimed, the two together are exactly "the increment that
    crossed this threshold, once" (§12).

    A refresh, a second tab, a route change, a remount, a PWA relaunch or a
    sign-in all return `shouldCelebrate: false` and mount neither overlay.
  */
  const milestone = milestoneFor(celebrate);
  return milestone ? (
    <StreakMilestoneCelebration
      streak={celebrate}
      tier={milestone}
      onDone={() => setCelebrate(null)}
    />
  ) : (
    <StreakCelebration streak={celebrate} onDone={() => setCelebrate(null)} />
  );
}
