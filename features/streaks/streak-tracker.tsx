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
  /*
    🔴 ONE overlay at a time — "celebration" or "gallery", NEVER both.

    Owner, 2026-09-08: "did you fix the streak flame modal exit issue? cause i
    still see it."

    They were right, and the earlier fix was in the wrong file. `StreakHeaderChip`
    had this same defect and was collapsed to a single value; THIS mount was not
    checked, and it is the one a member actually hits — it fires on the milestone
    ceremony, from `recordStreakActivity`, on any page.

    It held `unlock` and `gallery` as INDEPENDENT states, and
    `onViewGallery` set the second without clearing the first. So both full-screen
    overlays were mounted, the ceremony underneath the gallery; dismissing the
    gallery revealed it still sitting there and read as a close button that did
    nothing.

    A single discriminated value cannot express "both open", which is what makes
    that impossible now rather than merely repaired. The tier rides along with
    the ceremony because it is only meaningful there.
  */
  const [view, setView] = useState<
    | { kind: "none" }
    | { kind: "celebration"; streak: number; tier: StreakTier }
    | { kind: "gallery"; streak: number }
  >({ kind: "none" });
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
      if (tier) setView({ kind: "celebration", streak: state.currentStreak, tier });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      {view.kind === "celebration" ? (
        <StreakUnlockCelebration
          streak={view.streak}
          tier={view.tier}
          // Replaces the ceremony rather than layering over it.
          onViewGallery={() => setView({ kind: "gallery", streak: view.streak })}
          onDone={() => setView({ kind: "none" })}
        />
      ) : null}
      {view.kind === "gallery" ? (
        <StreakTiersSheet
          streak={data?.currentStreak ?? view.streak}
          state={data ?? null}
          // Closes to nothing. There is no second overlay left behind.
          onClose={() => setView({ kind: "none" })}
        />
      ) : null}
    </>
  );
}
