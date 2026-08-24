"use client";

import { Trophy } from "lucide-react";
import { useState } from "react";

import { StreakFlame } from "@/features/streaks/streak-flame";
import { restoreStreak, useStreak } from "@/features/streaks/use-streak";
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
  return (
    <section
      className={cn(
        "overflow-hidden rounded-[22px] border border-border/70 bg-card p-4",
        className,
      )}
      aria-labelledby="streak-card-heading"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500/15 to-orange-500/15">
          <StreakFlame className="h-7 w-7" gradient animated />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="streak-card-heading" className="text-[17px] font-semibold tracking-[-0.01em]">
            {state.currentStreak} Day Streak
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {state.currentStreak === 1
              ? "1 consecutive day"
              : `${state.currentStreak} consecutive days`}
          </p>
        </div>
      </div>

      {state.canRestore ? <RestoreRow state={state} /> : null}

      <dl className="mt-4 grid grid-cols-3 gap-2">
        <Stat label="Current" value={`${state.currentStreak}`} icon={<StreakFlame className="h-3.5 w-3.5" gradient />} />
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

/**
 * The restore offer (§16). Shown ONLY while the server says a restore is
 * genuinely available — never beside a healthy streak, and never after the
 * window or the lifetime cap has closed it.
 */
function RestoreRow({ state }: { state: StreakState }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <div className="mt-3.5 rounded-2xl border border-orange-500/25 bg-orange-500/[0.06] p-3">
      <p className="text-[13.5px] font-semibold">
        Restore your {state.restorableStreak}-day streak
      </p>
      <p className="mt-0.5 text-[12.5px] text-muted-foreground">
        {failed
          ? "That streak can no longer be restored."
          : "Your streak was interrupted. Restore it and keep going."}
      </p>
      {!failed ? (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            if (busy) return;
            setBusy(true);
            // The server is the only thing that can approve this; a `false`
            // here means the window closed or the allowance is spent, and the
            // honest answer is to say so rather than retry.
            const ok = await restoreStreak();
            setFailed(!ok);
            setBusy(false);
          }}
          className="mt-2.5 inline-flex h-9 items-center justify-center rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 text-[13px] font-semibold text-white transition-transform duration-150 active:scale-[0.97] disabled:opacity-60"
        >
          {busy ? "Restoring…" : "Restore Streak"}
        </button>
      ) : null}
    </div>
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
