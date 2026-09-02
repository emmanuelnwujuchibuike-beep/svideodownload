"use client";

import { Trophy } from "lucide-react";

import { StreakFlame } from "@/features/streaks/streak-flame";
import { StreakFlameMark } from "@/features/streaks/streak-flame-mark";
import { StreakRecovery } from "@/features/streaks/streak-recovery";
import { useStreak } from "@/features/streaks/use-streak";
import { tierFor } from "@/lib/streaks/tiers";
import type { StreakState } from "@/lib/streaks/types";
import { cn } from "@/lib/utils";

/**
 * The profile streak card: current streak, longest, total active days, last
 * active day, and a 7-day calendar.
 *
 * 🔴 IT DISPLAYS, IT NEVER CELEBRATES (§9). Opening a profile must not replay
 * the animation, and structurally it cannot: the celebration is raised only by
 * `StreakTracker`, from the server's `shouldCelebrate`, which is already false
 * once today has been marked. This component has no path to it at all.
 *
 * Renders nothing at all when there is no streak to show, so a brand-new
 * profile is exactly what it was before.
 */
export function StreakProfileCard({ className }: { className?: string }) {
  const { data } = useStreak();
  if (!data) return null;
  if (data.currentStreak < 1 && data.longestStreak < 1 && !data.canRestore) return null;
  return <StreakCard state={data} className={className} />;
}

function StreakCard({ state, className }: { state: StreakState; className?: string }) {
  /*
    🔴 THE CARD CARRIES THE RANK (owner, 2026-08-31: "the streaks flames and
    streak card in the profile, download and landing page are the same, only
    different is the color, they suppose to look more prestigious and glorious
    as it increases").

    It was worse than that here — this card was not even tier-COLOURED. It hard-
    coded the amber/orange tile and rendered a tier-less flame, so a 100-day
    member with a gold storming flame on the download hero opened their profile
    and found the day-one orange spark. The tier table has been the single
    source of the colours since 2026-08-30; this surface simply never joined.
  */
  const tier = tierFor(state.currentStreak);
  return (
    <section
      className={cn(
        "overflow-hidden rounded-[22px] border border-border/70 bg-card p-4",
        className,
      )}
      aria-labelledby="streak-card-heading"
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ring-1 ring-inset",
            tier ? `${tier.fill} ${tier.ring}` : "bg-gradient-to-br from-amber-500/15 to-orange-500/15 ring-transparent",
          )}
          /* The rank glow, at the same low alpha the hero chip uses — enough to
             read as lit, not enough to become a second focal point on a page
             that is mostly someone-s own content. */
          style={tier ? { boxShadow: `0 0 24px -10px ${tier.glow}` } : undefined}
        >
          <StreakFlameMark tier={tier} className="h-7 w-7" wrapperClassName="h-8 w-8" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="streak-card-heading" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[17px] font-semibold tracking-[-0.01em]">
            <span>{state.currentStreak} Day Streak</span>
            {/* §10 — the milestone is named, not merely coloured. A rank that
                only exists as a hue is invisible to anyone who does not already
                know the ladder, and unreadable to a screen reader. */}
            {tier ? (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.07em] ring-1 ring-inset",
                  tier.text,
                  tier.ring,
                )}
              >
                {tier.label}
              </span>
            ) : null}
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {state.currentStreak === 1
              ? "1 consecutive day"
              : `${state.currentStreak} consecutive days`}
          </p>
        </div>
      </div>

      {/*
        🔴 ONE recovery experience, shared with the flame gallery. This used to
        be a local `RestoreRow` that only knew how to say "restore" — it had no
        broken state, no countdown and nothing to show once the window closed,
        so a member past 48 hours simply saw nothing at all where §7 wants
        "YOUR NEXT STREAK STARTS HERE". See streak-recovery.tsx.
      */}
      <StreakRecovery state={state} className="mt-3.5" />

      <dl className="mt-4 grid grid-cols-3 gap-2">
        {/* Effects off at 14px: licks and smoke on a glyph this small are noise,
            not rank. The colour still comes from the tier. */}
        <Stat label="Current" value={`${state.currentStreak}`} icon={<StreakFlame className="h-3.5 w-3.5" gradient tier={tier} />} />
        <Stat label="Longest" value={`${state.longestStreak}`} icon={<Trophy className="h-3.5 w-3.5 text-amber-500" />} />
        <Stat label="Active days" value={`${state.totalActiveDays}`} />
      </dl>

      <StreakCalendar week={state.week} today={state.today} />

      <p className="mt-3 text-[12px] text-muted-foreground">
        {state.lastActivityDate === state.today
          ? "Active today"
          : state.lastActivityDate
            ? `Last active ${formatDay(state.lastActivityDate)}`
            : "No activity yet"}
      </p>
    </section>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-secondary/60 px-3 py-2.5">
      <dt className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 text-[19px] font-bold tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * The 7-day calendar. Days are letters + a tick or a dot, and each carries a
 * full accessible label — the state is never conveyed by the mark alone (§22).
 */
export function StreakCalendar({ week, today }: { week: StreakState["week"]; today: string }) {
  return (
    <ul className="mt-3.5 flex items-center justify-between gap-1" aria-label="Last 7 days">
      {week.map((day) => {
        const isToday = day.date === today;
        return (
          <li key={day.date} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <span aria-hidden className="text-[11px] font-medium text-muted-foreground">
              {weekdayLetter(day.date)}
            </span>
            <span
              aria-hidden
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold",
                day.active
                  ? "bg-gradient-to-br from-amber-500 to-orange-500 text-white"
                  : isToday
                    ? "ring-2 ring-inset ring-orange-500/40 text-muted-foreground"
                    : "bg-secondary text-muted-foreground/70",
              )}
            >
              {day.active ? "✓" : "•"}
            </span>
            <span className="sr-only">
              {formatDay(day.date)}: {day.active ? "active" : "no activity"}
              {isToday ? " (today)" : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* ── Formatting ─────────────────────────────────────────────────────────── */

/**
 * 🔴 Parsed as UTC and formatted in UTC. These strings are calendar LABELS the
 * server already resolved in the user's zone; re-interpreting them in the
 * browser's zone would shift half of them by a day.
 */
function formatDay(date: string): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) return date;
  return new Date(ms).toLocaleDateString(undefined, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

function weekdayLetter(date: string): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) return "?";
  return new Date(ms).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" }).charAt(0);
}
