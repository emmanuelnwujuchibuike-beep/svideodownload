"use client";

import { useEffect, useRef } from "react";

import { Portal } from "@/components/ui/portal";
import { StreakFlameMark } from "@/features/streaks/streak-flame-mark";
import { STREAK_TIERS, nextTier, tierFor } from "@/lib/streaks/tiers";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FLAME GALLERY — every rank, and what it takes to get there
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-08-31: "let anonymous and signed in users be able to see an
 * example of all the flames and description when they click the streak button
 * so they can be encouraged to get it, and let the modal stay open untill the
 * user tap around it, it shouldnt close after 3secs, and make change the modal
 * background from black to a premium background."
 *
 * ── What this replaces, and why it had to change shape ───────────────────────
 *
 * The chip used to open a 2-second, `pointer-events-none`, self-dismissing
 * popover showing only the CURRENT tier. That was the right object for "glance
 * at my streak" and the wrong one for "show me what I am working toward":
 * six flames with a sentence each cannot be read in two seconds, and a
 * `pointer-events-none` element cannot be dismissed by tapping it, so the only
 * possible exit was to wait.
 *
 * So it becomes a real dialog. That brings obligations the popover did not have
 * and they are all met below: it is dismissible three ways (backdrop, Escape,
 * an explicit close button), it returns focus to the chip that opened it, and
 * it is labelled. §20 is explicit that the user must never be trapped.
 *
 * ── Anonymous visitors are the POINT, not an edge case ───────────────────────
 *
 * This takes a plain `streak` number and nothing else — no session, no fetch,
 * no gating. An anonymous first-time visitor on day 1 is exactly who this is
 * for: they have a real streak (`lib/streaks/identity.ts` mints them a
 * server-side id) and the gallery is the only place that tells them the flame
 * changes at all.
 *
 * ── Perf (§14) ───────────────────────────────────────────────────────────────
 *
 * `next/dynamic`'d by the chip, so none of this — nor the six live tier marks —
 * is in the landing page's first-load bundle. It is fetched on the first tap
 * and never on a page open, which matters on the route with the 1.6s budget.
 */
export function StreakTiersSheet({ streak, onClose }: { streak: number; onClose: () => void }) {
  const panel = useRef<HTMLDivElement | null>(null);
  const closeBtn = useRef<HTMLButtonElement | null>(null);
  /** Whatever had focus when this opened, so it can be handed back on close. */
  const restoreTo = useRef<Element | null>(null);

  const current = tierFor(streak);
  const upcoming = nextTier(streak);

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
      🔴 The page behind must not scroll while this is open (§18: "prevent
      accidental page scrolling"). Restored to whatever it WAS, not to "", so
      this cannot clobber another overlay's own lock if the two ever overlap.
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
          Tap ANYWHERE outside the panel closes it — the owner's "untill the
          user tap around it". The check is `e.target === e.currentTarget` so a
          tap that lands on the panel and bubbles up here does not also close
          it, which is the classic version of this bug.
        */
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        className="streak-sheet-scrim fixed inset-0 z-[120] flex items-end justify-center overflow-y-auto overscroll-contain p-3 sm:items-center"
      >
        <div
          ref={panel}
          /*
            🔴 A PREMIUM GROUND, NOT BLACK (owner). Light mode is a warm
            off-white with a champagne wash rather than an inverted dark panel —
            §19 is explicit that light must be designed, not derived. Dark mode
            is a deep indigo-black with the same wash at low alpha, so the two
            read as one designed object rather than two themes of a rectangle.

            The safe-area padding is what keeps the close button clear of the
            notch and the last row clear of the home indicator in standalone
            PWA mode (§18).
          */
          className="streak-sheet-panel relative w-full max-w-md rounded-[1.75rem] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_30px_80px_-20px_rgba(15,23,42,0.55)] sm:p-5"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="streak-tiers-title" className="text-base font-extrabold tracking-tight text-foreground">
                Your flame
              </h2>
              <p className="mt-0.5 text-[12.5px] font-medium text-muted-foreground">
                {current
                  ? upcoming
                    ? `${streak} ${streak === 1 ? "day" : "days"} · ${upcoming.inDays} more to ${upcoming.tier.label}`
                    : `${streak} days · the rarest flame there is`
                  : "Open Frenzsave two days running to start a streak."}
              </p>
            </div>
            <button
              ref={closeBtn}
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="srch-press -mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground ring-1 ring-inset ring-border/60 transition hover:bg-foreground/5"
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
            Ordered SHORTEST FIRST here, the opposite of the table, because this
            is a ladder the reader climbs — `STREAK_TIERS` is longest-first only
            so `tierFor` can return the first match.
          */}
          <ul className="mt-4 space-y-2">
            {[...STREAK_TIERS]
              .slice()
              .reverse()
              .map((tier) => {
                const reached = streak >= tier.minDays;
                const isCurrent = current?.id === tier.id;
                return (
                  <li
                    key={tier.id}
                    aria-current={isCurrent ? "true" : undefined}
                    className={`flex items-center gap-3 rounded-2xl p-2.5 ring-1 ring-inset transition ${
                      isCurrent
                        ? `${tier.fill} ${tier.ring}`
                        : "ring-border/45 dark:ring-white/[0.07]"
                    }`}
                    style={isCurrent ? { boxShadow: `0 0 22px -8px ${tier.glow}` } : undefined}
                  >
                    {/*
                      🔴 THE LIVE MARK, not a static swatch. The whole request is
                      that someone can SEE what they are working toward, and the
                      motion is half of what distinguishes the ranks now — a
                      still purple flame and a still blue one are just two
                      colours. Locked tiers are dimmed rather than hidden or
                      greyed: the reward has to be visible to be a reward.
                    */}
                    <span className={reached ? "" : "opacity-45 saturate-[0.55]"}>
                      <StreakFlameMark
                        tier={tier}
                        className="h-[26px] w-[26px]"
                        wrapperClassName="h-[34px] w-[34px]"
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-1.5">
                        <span className={`text-[13.5px] font-bold ${reached ? tier.text : "text-foreground/70"}`}>
                          {tier.label}
                        </span>
                        <span className="text-[11px] font-semibold text-muted-foreground">
                          {tier.minDays === 1 ? "Day 1" : `${tier.minDays} days`}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
                        {tier.blurb}
                      </span>
                    </span>
                    {isCurrent ? (
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] ${tier.text} ring-1 ring-inset ${tier.ring}`}
                      >
                        You
                      </span>
                    ) : null}
                  </li>
                );
              })}
          </ul>

          <p className="mt-3 text-center text-[11px] font-medium text-muted-foreground">
            Open Frenzsave once a day to keep your streak alive.
          </p>
        </div>
      </div>
    </Portal>
  );
}
