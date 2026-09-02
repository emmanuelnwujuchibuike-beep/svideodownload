"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import { recordStreakActivity, useStreak } from "@/features/streaks/use-streak";
import { milestoneFor, type StreakTier } from "@/lib/streaks/tiers";

/**
 * The single place a day's activity is recorded, and the only thing that can
 * raise a celebration. Renders nothing of its own.
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
 * with LCP, hero rendering or PWA startup. The ceremony chunk is code-split and
 * only requested when the server has actually said to celebrate — so on the
 * ~359 days a year that are not a flame upgrade its bytes are never fetched.
 */

/*
  🔴 ONE OVERLAY, WHERE THERE USED TO BE TWO.

  Owner, 2026-09-01: "there shoudnlt be a celebration everyday, only on flame
  upgrade." The daily `StreakCelebration` — a 2.6s full-screen flash that fired
  on every increment — is deleted, not merely suppressed: leaving it in the tree
  behind a condition is how it comes back. What remains is the unlock ceremony,
  which by construction can only play on a rung.
*/
const StreakUnlockCelebration = dynamic(
  () =>
    import("@/features/streaks/streak-unlock-celebration").then((m) => m.StreakUnlockCelebration),
  { ssr: false },
);

/*
  The gallery is the ceremony's primary CTA ("VIEW FLAME GALLERY", §3), so the
  tracker owns the handoff between them. It is the same chunk the hero chip
  opens — a second copy would be a second gallery to keep in sync, and the
  member would notice the day the two disagreed.
*/
const StreakTiersSheet = dynamic(
  () => import("@/features/streaks/streak-tiers-sheet").then((m) => m.StreakTiersSheet),
  { ssr: false },
);

export function StreakTracker() {
  const [unlock, setUnlock] = useState<{ streak: number; tier: StreakTier } | null>(null);
  const [gallery, setGallery] = useState<number | null>(null);
  const { data } = useStreak();
  const ran = useRef(false);

  useEffect(() => {
    // React StrictMode double-invokes effects in development; without this the
    // day would be recorded twice (harmless — the server dedupes — but it is a
    // wasted request on every single page open).
    if (ran.current) return;
    ran.current = true;

    let cancelled = false;
    void recordStreakActivity().then((state) => {
      if (cancelled || !state || !state.shouldCelebrate) return;
      /*
        🔴 THE SERVER ALREADY DECIDED. `shouldCelebrate` is now gated on
        `milestoneFor()` server-side, so this no longer forks on the number —
        it only needs the TIER in order to render, and asking the same pure
        function for it cannot disagree with the server that used it.

        The null guard is not dead code: it is what keeps a future server that
        loosens the gate from rendering a ceremony with no rank attached.
      */
      const tier = milestoneFor(state.currentStreak);
      if (tier) setUnlock({ streak: state.currentStreak, tier });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      {unlock ? (
        <StreakUnlockCelebration
          streak={unlock.streak}
          tier={unlock.tier}
          onViewGallery={() => setGallery(unlock.streak)}
          onDone={() => setUnlock(null)}
        />
      ) : null}
      {gallery !== null ? (
        <StreakTiersSheet
          streak={data?.currentStreak ?? gallery}
          state={data ?? null}
          onClose={() => setGallery(null)}
        />
      ) : null}
    </>
  );
}
