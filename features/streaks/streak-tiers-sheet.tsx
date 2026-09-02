"use client";

import { useEffect, useRef } from "react";

import { Portal } from "@/components/ui/portal";
import { StreakFlameMark } from "@/features/streaks/streak-flame-mark";
import { StreakRecovery } from "@/features/streaks/streak-recovery";
import { STREAK_TIERS, nextTier, tierFor } from "@/lib/streaks/tiers";
import type { StreakState } from "@/lib/streaks/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FLAME GALLERY — every rank, what it takes, and what you already own
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-01: keep the structure, "make the EXISTING SYSTEM feel more
 * premium, sophisticated and rewarding while maintaining its recognizable
 * Frenzsave identity … Upgrade the PRESENTATION, not the identity." So the six
 * ranks, their names and their order are exactly what they were; what changed
 * is the surface they sit on, the state each row can be in, and one real bug.
 *
 * ── 🔴 THE BUG: A BROKEN STREAK USED TO DELETE YOUR FLAMES ───────────────────
 *
 * Every row asked `streak >= tier.minDays` against the CURRENT streak. So a
 * member who reached 100 days and then missed one opened this panel and found
 * gold, purple, green and blue all locked again — the achievement silently
 * revoked by a single missed day. §6 is unambiguous: "Unlocking a flame is a
 * PERMANENT ACHIEVEMENT … Breaking the current streak should NOT remove
 * previously unlocked flames from the Flame Gallery."
 *
 * The fix is to separate two questions that were being answered by one number:
 *
 *   • UNLOCKED  → `longestStreak`. Monotonic by construction (`applyActivity`
 *                 only ever raises it via `Math.max`), so nothing can take a
 *                 flame back. This is the permanent record.
 *   • CURRENT   → `currentStreak`. Where the member is standing today, which is
 *                 allowed to fall, and which drives the "You" marker and the
 *                 progress line.
 *
 * A row can therefore read "owned, but not lit right now", which is the honest
 * state after a break and the one that makes restoring feel worth doing.
 *
 * ── Anonymous visitors are the POINT, not an edge case ───────────────────────
 *
 * `state` is optional. An anonymous first-time visitor on day 1 arrives with a
 * display-cached number and no fetched state, and still gets the full ladder —
 * they have a real streak (`lib/streaks/identity.ts` mints them a server-side
 * id) and this panel is the only place that tells them the flame changes.
 *
 * ── Perf (§12) ───────────────────────────────────────────────────────────────
 *
 * `next/dynamic`'d by the chip, so neither this nor its six live tier marks is
 * in the landing page's first-load bundle. Fetched on the first tap, never on a
 * page open — which is what keeps it off the route with the 1.6s budget.
 */
export function StreakTiersSheet({
  streak,
  state,
  onClose,
}: {
  streak: number;
  state?: StreakState | null;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  const closeBtn = useRef<HTMLButtonElement | null>(null);
  /** Whatever had focus when this opened, so it can be handed back on close. */
  const restoreTo = useRef<Element | null>(null);

  const current = tierFor(streak);
  const upcoming = nextTier(streak);
  /*
    The permanent high-water mark. `longestStreak` can lag the live number by a
    request on the day it is being set, so the larger of the two is the honest
    "has ever reached" — it can only ever be too generous by the moment.
  */
  const unlockedTo = Math.max(streak, state?.longestStreak ?? 0);

  useEffect(() => {
    restoreTo.current = document.activeElement;
    // Focus the close button rather than the panel: it is the escape hatch, so
    // a keyboard or switch user's first Tab-free action is always "get out".
    closeBtn.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);

    /*
      🔴 The page behind must not scroll while this is open. Restored to
      whatever it WAS, not to "", so this cannot clobber another overlay's own
      lock if the two ever overlap.
    */
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      // Only take focus back if it is still inside this dialog — if the user
      // has already clicked something else, stealing it back is hostile.
      if (panel.current?.contains(document.activeElement)) {
        (restoreTo.current as HTMLElement | null)?.focus?.();
      }
    };
  }, [onClose]);

  return (
    <Portal>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="streak-tiers-title"
        /*
          Tap ANYWHERE outside the panel closes it. The check is
          `e.target === e.currentTarget` so a tap that lands on the panel and
          bubbles up here does not also close it — the classic version of this
          bug.
        */
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        className="streak-sheet-scrim fixed inset-0 z-[120] flex items-end justify-center overflow-y-auto overscroll-contain p-3 sm:items-center"
      >
        <div
          ref={panel}
          /*
            🔴 A PREMIUM GROUND, NOT BLACK. Light mode is a warm off-white with
            a champagne wash rather than an inverted dark panel — light must be
            designed, not derived. Dark mode is a deep indigo-black with the
            same wash at low alpha, so the two read as one designed object
            rather than two themes of a rectangle.

            The safe-area padding keeps the close button clear of the notch and
            the last row clear of the home indicator in standalone PWA mode.
          */
          className="streak-sheet-panel relative w-full max-w-[26rem] rounded-[1.75rem] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="streak-tiers-title" className="streak-sheet-title">
                Flame gallery
              </h2>
              {/*
                🔴 DOWNLOADS, NOT LOGINS (§2). "Do NOT describe the flames as
                simply 'login streaks.'" The backend rule is unchanged — one
                credit per local day — but what a day MEANS here is a day you
                came and saved something.
              */}
              <p className="streak-sheet-sub">
                {current
                  ? upcoming
                    ? `${streak} ${streak === 1 ? "day" : "days"} · ${upcoming.inDays} more to ${upcoming.tier.label}`
                    : `${streak} days · the rarest flame there is`
                  : "Download something today to light your first flame."}
              </p>
            </div>
            <button
              ref={closeBtn}
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="streak-sheet-close srch-press"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden focusable="false">
                <path
                  d="M6 6l12 12M18 6L6 18"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
            </button>
          </div>

          {/*
            The broken/restore state, at the top where it is the first thing
            read — a recovery window with hours left on it is more urgent than
            the ladder below it. Renders nothing at all when the streak is
            healthy, which is almost always.
          */}
          {state ? <StreakRecovery state={state} className="mt-3.5" onDismiss={onClose} /> : null}

          {/*
            Ordered SHORTEST FIRST here, the opposite of the table, because this
            is a ladder the reader climbs — `STREAK_TIERS` is longest-first only
            so `tierFor` can return the first match.
          */}
          <ul className="streak-sheet-list">
            {[...STREAK_TIERS].reverse().map((tier) => {
              const unlocked = unlockedTo >= tier.minDays;
              const isCurrent = current?.id === tier.id;
              /* Owned but not lit: the state that only exists after a break. */
              const dormant = unlocked && streak < tier.minDays;
              const away = tier.minDays - streak;
              return (
                <li
                  key={tier.id}
                  aria-current={isCurrent ? "true" : undefined}
                  data-state={unlocked ? (isCurrent ? "current" : "unlocked") : "locked"}
                  className={`streak-rank ${isCurrent ? `${tier.fill} ${tier.ring}` : ""}`}
                  style={isCurrent ? { ["--rank-glow" as string]: tier.glow } : undefined}
                >
                  {/*
                    🔴 THE LIVE MARK, not a static swatch. The whole point is
                    that someone can SEE what they are working toward, and the
                    motion is half of what distinguishes the ranks now — a still
                    purple flame and a still blue one are just two colours.

                    Locked flames stay VISIBLE and recognisable (§5) — muted,
                    desaturated and dimmed by CSS, never hidden and never
                    replaced by a padlock. A reward you cannot see is not a
                    reward. Their motion is switched off at the source rather
                    than merely dimmed, because an animating locked flame reads
                    as available.
                  */}
                  <span className="streak-rank-mark">
                    <StreakFlameMark
                      tier={tier}
                      effects={unlocked}
                      className="h-[26px] w-[26px]"
                      wrapperClassName="h-[34px] w-[34px]"
                    />
                  </span>

                  <span className="streak-rank-body">
                    <span className="streak-rank-line">
                      <span className={`streak-rank-name ${unlocked ? tier.text : ""}`}>
                        {tier.label}
                      </span>
                      <span className="streak-rank-days">
                        {tier.minDays === 1 ? "Day 1" : `${tier.minDays} days`}
                      </span>
                    </span>
                    <span className="streak-rank-blurb">{tier.blurb}</span>
                  </span>

                  {/*
                    The right-hand state chip. Exactly one of four, and each
                    says something the row cannot say without it:
                      • You       — where you are standing now
                      • Unlocked  — owned, but the streak has since broken (§6)
                      • N more    — the distance §5 asks for ("18 more days")
                      • Locked    — no distance to quote, because there is no
                                    live streak to count from
                  */}
                  {isCurrent ? (
                    <span className={`streak-rank-chip ${tier.text} ${tier.ring}`}>You</span>
                  ) : dormant ? (
                    <span className="streak-rank-chip streak-rank-chip-owned">Unlocked</span>
                  ) : away > 0 && streak > 0 ? (
                    <span className="streak-rank-chip streak-rank-chip-locked">
                      {away} more {away === 1 ? "day" : "days"}
                    </span>
                  ) : (
                    <span className="streak-rank-chip streak-rank-chip-locked">Locked</span>
                  )}
                </li>
              );
            })}
          </ul>

          <p className="streak-sheet-foot">Your downloads keep the flame alive.</p>
        </div>
      </div>
    </Portal>
  );
}
