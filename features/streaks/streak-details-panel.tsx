"use client";

import { ChevronRight, Lock, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Portal } from "@/components/ui/portal";
import { StreakFlameMark } from "@/features/streaks/streak-flame-mark";
import { STREAK_TIERS, tierFor, type StreakTier } from "@/lib/streaks/tiers";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE STREAK PANEL — what the header chip opens
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Built from the owner's marked-up screenshot, 2026-09-08: "Opens a beautiful,
 * premium panel with your streak info, flame gallery and motivation."
 *
 * Top to bottom, as drawn: the flame, "14 Day Streak", "Keep your flame alive",
 * a line of motivation, the milestone rail with its locks, the Flame Gallery
 * row, and View All Flames.
 *
 * ── 🔴 THE MILESTONES ARE READ FROM THE TIER TABLE, NOT TYPED OUT ───────────
 *
 * The reference draws five: 7 Days, 14 Days, 30 Days, 6 Months, 1 Year. Those
 * are real tiers in `lib/streaks/tiers.ts`, which is also what awards them,
 * colours their flames and decides when a celebration fires. Hard-coding the
 * list here would be a second source of truth for the one thing this panel
 * exists to describe — and the day somebody adds a tier, this panel would
 * quietly disagree with the badge the member actually earned.
 *
 * ── Dark on purpose, on a light page ────────────────────────────────────────
 *
 * The reference is dark and it is not decoration: these flames are luminous
 * artwork, and a glow only reads against something dark. This is the one
 * surface in the product that overrides the visitor's theme, for the same
 * reason a photo gallery does.
 *
 * ── The performance rule ────────────────────────────────────────────────────
 *
 * Fetched on the first tap and never on a page open. No image, no
 * backdrop-blur, and the only motion is the entrance transform plus whatever
 * the flame marks already do — they are the subject, so they keep it.
 */
export function StreakDetailsPanel({
  streak,
  onClose,
  onOpenGallery,
}: {
  streak: number;
  onClose: () => void;
  /**
   * 🔴 The gallery REPLACES this panel; it does not sit on top of it.
   *
   * Owner, 2026-09-08: "the streak gallery modal also doesnt exit
   * immediately". It closed instantly on its own — the problem was that this
   * panel rendered it as a child, so two fixed overlays with two scrims were
   * stacked, and dismissing the top one revealed the bottom one still sitting
   * there. It read as a tap that did nothing.
   *
   * Handing the decision up means exactly one overlay exists at any moment.
   */
  onOpenGallery: () => void;
}) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Escape closes it. A panel that can only be dismissed by finding a small X
  // is a panel somebody gets stuck in.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /*
    Oldest first, so the rail reads left-to-right as a journey. `STREAK_TIERS`
    is ordered longest-first because `tierFor` walks it looking for the highest
    match, and reversing here is cheaper and clearer than making that lookup
    scan backwards.
  */
  const rail = [...STREAK_TIERS].sort((a, b) => a.minDays - b.minDays);

  return (
    <Portal>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${streak} day streak`}
        className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center"
      >
        {/* The scrim. Tapping it closes — the ordinary expectation for a sheet. */}
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className={cn(
            "absolute inset-0 bg-slate-950/70 transition-opacity duration-300 motion-reduce:transition-none",
            entered ? "opacity-100" : "opacity-0",
          )}
        />

        <div
          className={cn(
            "relative m-3 w-full max-w-sm overflow-hidden rounded-[1.75rem]",
            "bg-gradient-to-b from-[#141334] via-[#0f0c26] to-[#07061a] text-white",
            "shadow-[0_30px_80px_-24px_rgb(2_6_23/0.9)] ring-1 ring-inset ring-white/10",
            "transition-all duration-300 ease-out motion-reduce:transition-none",
            entered ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0",
          )}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -top-16 h-40"
            style={{
              background:
                "radial-gradient(50% 100% at 50% 100%, rgba(251,146,60,0.35) 0%, transparent 70%)",
            }}
          />

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 z-[1] flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/70 transition hover:bg-white/20 hover:text-white"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>

          <div className="relative z-[1] px-5 pb-5 pt-8 text-center">
            <StreakFlameMark tier={tierFor(streak)} className="mx-auto h-14 w-14" />

            <h2 className="mt-3 text-[1.6rem] font-extrabold leading-tight tracking-[-0.02em]">
              {streak} Day Streak
            </h2>
            <p className="mt-1 text-[13px] text-white/60">Keep your flame alive</p>

            {/*
              The motivation line from the reference. Deliberately about the
              PERSON rather than the product — a streak is a promise somebody
              made to themselves, and this is the only sentence on the panel
              that acknowledges that.
            */}
            <p className="mt-3 text-[12.5px] font-semibold leading-relaxed text-white/80">
              Same you. Bigger dreams.
              <br />
              Don&apos;t break the streak!
            </p>

            <MilestoneRail rail={rail} streak={streak} className="mt-5" />

            {/* ── the Flame Gallery row ─────────────────────────────────── */}
            <button
              type="button"
              onClick={onOpenGallery}
              className="mt-5 flex w-full items-center gap-3 rounded-2xl bg-white/[0.07] px-3.5 py-3 text-left ring-1 ring-inset ring-white/10 transition hover:bg-white/[0.11]"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10">
                <StreakFlameMark tier={tierFor(streak)} className="h-6 w-6" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-bold">Flame Gallery</span>
                <span className="mt-0.5 block text-[12px] leading-snug text-white/60">
                  Collect different flames as you reach new milestones.
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-white/50" aria-hidden />
            </button>

            <button
              type="button"
              onClick={onOpenGallery}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500 px-5 py-3 text-sm font-bold text-white shadow-[0_14px_34px_-12px_rgb(99_102_241/0.95)] transition active:scale-[0.99]"
            >
              View All Flames
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

/**
 * The milestone rail: a flame per tier, dimmed and locked until it is reached.
 *
 * 🔴 The connector is drawn from each item BACK to the previous one, so it can
 * never dangle past the last flame — the same shape the AI Clean progress
 * tracker uses, and for the same reason.
 */
function MilestoneRail({
  rail,
  streak,
  className,
}: {
  rail: readonly StreakTier[];
  streak: number;
  className?: string;
}) {
  return (
    <ol className={cn("flex items-start justify-between gap-1", className)}>
      {rail.map((tier, i) => {
        const reached = streak >= tier.minDays;
        // The one the member is standing on: reached, and the next is not.
        const current = reached && (rail[i + 1] ? streak < rail[i + 1]!.minDays : true);

        return (
          <li key={tier.id} className="relative flex min-w-0 flex-1 flex-col items-center">
            {i > 0 ? (
              <span
                aria-hidden
                className={cn(
                  "absolute right-1/2 top-6 h-px w-[calc(100%-1.5rem)] translate-x-[-0.75rem]",
                  reached ? "bg-orange-400/50" : "bg-white/15",
                )}
              />
            ) : null}

            <span
              className={cn(
                "relative z-[1] flex h-12 w-12 items-center justify-center rounded-full ring-1 transition",
                reached ? "bg-white/[0.07] ring-white/20" : "bg-white/[0.04] ring-white/10",
                current && "ring-2 ring-orange-400/70 shadow-[0_0_0_5px_rgb(251_146_60/0.14)]",
              )}
            >
              {reached ? (
                <StreakFlameMark tier={tier} className="h-6 w-6" effects={false} />
              ) : (
                <Lock className="h-4 w-4 text-white/35" aria-hidden />
              )}
            </span>

            <span
              className={cn(
                "mt-1.5 text-center text-[10px] leading-tight",
                reached ? "font-bold text-white/90" : "text-white/45",
              )}
            >
              {labelFor(tier.minDays)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * "7 Days", "6 Months", "1 Year" — the reference's own wording.
 *
 * Derived from the day count rather than stored, because the tier table's
 * `label` is a NAME ("Committed", "Legendary") and this rail wants a DURATION.
 * Two different jobs; adding a second label field to the table for one caller
 * would be the wrong place to put it.
 */
function labelFor(days: number): string {
  if (days >= 365) return "1 Year";
  if (days >= 30 && days % 30 === 0) {
    const months = days / 30;
    return months === 1 ? "1 Month" : `${months} Months`;
  }
  return `${days} Days`;
}
