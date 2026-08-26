"use client";

import { Bell, Flame, RefreshCw, RotateCcw, TrendingDown, Trophy, UserRound, Users } from "lucide-react";
import { useCallback, useState } from "react";

import type { StreakAdminMetrics, StreakMember } from "@/lib/streaks/admin";
import { cn, formatCompactNumber } from "@/lib/utils";

/**
 * Streak retention for the admin dashboard.
 *
 * Same shape as `PushDeliveryMonitor` and `MessagingMonitor` — the established
 * pattern for a section on this page — so it reads as part of the dashboard
 * rather than as a bolted-on panel for one feature.
 *
 * 🔴 Every figure here is an exact `count` query (see lib/streaks/admin.ts).
 * None is sampled, estimated or extrapolated. A dashboard number that is
 * quietly a sample is how this project produced a confident, wrong "0" once
 * before; where a figure IS an approximation — the at-risk count, which is
 * measured in UTC rather than per-person — it says so on screen.
 */
export function StreakMonitor({
  metrics: initial,
  members = [],
}: {
  metrics: StreakAdminMetrics;
  /** Signed-in members currently on a streak, longest first. */
  members?: StreakMember[];
}) {
  /*
    Refreshed IN PLACE from /api/admin/streaks rather than with
    `router.refresh()`. These numbers move minute to minute — a streak is
    claimed the moment someone opens the app — and the alternative re-runs
    every other panel on this page (subscribers, moderation, trending, the
    activity feed) to update four counters. The endpoint already exists and is
    already admin-guarded.
  */
  const [metrics, setMetrics] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [at, setAt] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch("/api/admin/streaks", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setMetrics((await res.json()) as StreakAdminMetrics);
      setAt(new Date().toLocaleTimeString());
    } catch {
      // Say so. A refresh button that silently leaves stale numbers on screen
      // is worse than no button — the reader believes they are current.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, []);

  const retention2 = pct(metrics.streaks2Plus, metrics.activeStreaks);
  const retention7 = pct(metrics.streaks7Plus, metrics.activeStreaks);

  return (
    <section className="mt-6 overflow-hidden rounded-3xl border border-border/70 bg-card p-6 shadow-card">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Flame className="h-5 w-5 text-orange-500" /> Streaks
        </h2>
        <div className="flex items-center gap-2">
          {failed ? (
            <span className="text-[11px] font-medium text-rose-600 dark:text-rose-400">Couldn&apos;t refresh</span>
          ) : at ? (
            <span className="text-[11px] text-muted-foreground tabular-nums">Updated {at}</span>
          ) : null}
          <button
            type="button"
            onClick={refresh}
            disabled={busy}
            aria-label="Refresh streak metrics"
            className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-secondary/40 px-3 py-1.5 text-xs font-semibold transition hover:bg-secondary disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", busy && "motion-safe:animate-spin")} />
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Mini icon={Flame} label="Active streaks" value={formatCompactNumber(metrics.activeStreaks)} />
        <Mini icon={Users} label="2+ days" value={formatCompactNumber(metrics.streaks2Plus)} sub={retention2} />
        <Mini icon={Trophy} label="7+ days" value={formatCompactNumber(metrics.streaks7Plus)} sub={retention7} />
        <Mini
          icon={Trophy}
          label="30+ days"
          value={formatCompactNumber(metrics.streaks30Plus)}
          sub={pct(metrics.streaks30Plus, metrics.activeStreaks)}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Panel
          icon={Bell}
          label="At risk right now"
          value={formatCompactNumber(metrics.atRisk)}
          tone={metrics.activeStreaks > 0 && metrics.atRisk / metrics.activeStreaks > 0.4 ? "warn" : "neutral"}
          note="Live streaks whose last activity was yesterday, so today is still unclaimed. Counted in UTC — the reminder job itself decides per person, in their own timezone."
        />
        <Panel
          icon={Bell}
          label="Reminders sent today"
          value={formatCompactNumber(metrics.remindersToday)}
          note="Claimed by the hourly job. One per identity per calendar day, so this can never exceed the number of people at risk."
        />
        <Panel
          icon={RotateCcw}
          label="Streaks restored"
          value={formatCompactNumber(metrics.restored)}
          note="Identities that have spent at least one restore. Restores are capped per identity, so this cannot run away."
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Panel
          icon={UserRound}
          label="Anonymous share"
          value={`${metrics.anonymousShare}%`}
          note="Streaks belonging to a browser identity rather than an account. Anonymous visitors get the full streak experience, so a high share here is the feature working, not a gap."
        />
        <Panel
          icon={Bell}
          label="Push failures (24h)"
          value={formatCompactNumber(metrics.pushFailures24h)}
          tone={metrics.pushFailures24h > 0 ? "warn" : "neutral"}
          note="Delivery attempts logged as failed across the whole app after one automatic retry — not streak-specific. Cross-check against Push delivery above."
        />
      </div>

      {/*
        ── Days lost / restored (owner, 2026-08-25) ─────────────────────────
        "how many days lost and restored".

        🔴 THESE ARE NOT BACKFILLABLE AND THE PANEL SAYS SO. Before migration
        0135 a broken run left no trace anywhere — `applyActivity` overwrote
        `current_streak` with 1 and the length of the run that just ended
        ceased to exist. So the ledger starts on the day it shipped and accrues
        forward. Showing "0 days lost" with no such note would read as "nobody
        has ever lost a streak", which is a fabricated statistic rather than a
        measured one.
      */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Panel
          icon={TrendingDown}
          label="Days lost"
          value={formatCompactNumber(metrics.daysLost)}
          tone={metrics.daysLost > 0 ? "warn" : "neutral"}
          note={
            metrics.ledgerSince
              ? `Total length of every streak that has broken since ${metrics.ledgerSince}, across ${formatCompactNumber(metrics.lossEvents)} broken run${metrics.lossEvents === 1 ? "" : "s"}.`
              : "Total length of every streak that breaks from here on. Nothing recorded yet — losses were not written down before this ledger existed, so there is no history to backfill."
          }
        />
        <Panel
          icon={RotateCcw}
          label="Days restored"
          value={formatCompactNumber(metrics.daysRestored)}
          note={
            metrics.ledgerSince
              ? `Days brought back by ${formatCompactNumber(metrics.restoreEvents)} restore${metrics.restoreEvents === 1 ? "" : "s"}. Counts DAYS, unlike "Streaks restored" above, which counts people.`
              : 'Days brought back by restores from here on. Counts DAYS, unlike "Streaks restored" above, which counts people.'
          }
        />
      </div>

      {/*
        The list the owner asked for by name: "signed in users who are on streak
        and how many days streak". Signed-in only — an anonymous identity has no
        name to show, and "Anonymous share" above is where their reach is
        reported instead.
      */}
      <StreakMemberTable members={members} />

      <p className="mt-4 border-t border-border/60 pt-3 text-xs text-muted-foreground">
        Streaks can be switched off without losing data: the{" "}
        <span className="font-medium text-foreground">streak-system</span> and{" "}
        <span className="font-medium text-foreground">streak-notifications</span> flags are in{" "}
        <span className="font-medium text-foreground">Feature flags</span>. Turning either off stops recording or
        reminding immediately and leaves every stored streak intact.
      </p>
    </section>
  );
}

/**
 * The signed-in streak roster.
 *
 * 🔴 A real `<table>`, not a grid of divs. This is tabular data with a header
 * row, and a screen reader reading "Ada 14 3 0" out of a stack of divs conveys
 * nothing — the column association is the information.
 *
 * Scrolls inside its OWN container (`overflow-x-auto`), so a long handle can
 * never make the admin page itself scroll sideways.
 */
function StreakMemberTable({ members }: { members: StreakMember[] }) {
  if (members.length === 0) {
    return (
      <div className="mt-4 rounded-2xl border border-dashed border-border/70 bg-secondary/20 p-5 text-center text-xs text-muted-foreground">
        No signed-in member is on a streak right now. Anonymous visitors keep their own streaks —
        see <span className="font-medium text-foreground">Anonymous share</span> above.
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-border/60">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-secondary/30 px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-medium">
          <UserRound className="h-4 w-4 text-muted-foreground" /> Members on a streak
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          Top {members.length} by current streak
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="px-4 py-2 font-semibold">Member</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Streak</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Best</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Lost</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Restored</th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">Last active</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId} className="border-b border-border/40 last:border-0">
                <th scope="row" className="max-w-[14rem] truncate px-4 py-2.5 text-left font-medium">
                  {m.displayName || (m.handle ? `@${m.handle}` : "Member")}
                  {m.handle && m.displayName ? (
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">@{m.handle}</span>
                  ) : null}
                </th>
                <td className="px-3 py-2.5 text-right font-bold tabular-nums text-orange-600 dark:text-orange-400">
                  {m.currentStreak}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{m.longestStreak}</td>
                {/* An em dash, not a 0: before the ledger existed there is no
                    difference between "lost nothing" and "not recorded", and
                    printing 0 would assert the first. */}
                <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                  {m.daysLost > 0 ? m.daysLost : "—"}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                  {m.daysRestored > 0 ? m.daysRestored : "—"}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                  {m.lastActivityDate ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function pct(part: number, whole: number): string | undefined {
  if (whole <= 0) return undefined;
  return `${Math.round((part / whole) * 100)}% of active`;
}

function Mini({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Flame;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-secondary/25 p-4">
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-4 w-4" /> {label}
      </span>
      <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

function Panel({
  icon: Icon,
  label,
  value,
  note,
  tone = "neutral",
}: {
  icon: typeof Flame;
  label: string;
  value: string;
  note: string;
  tone?: "neutral" | "warn";
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-secondary/25 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Icon className="h-4 w-4 text-muted-foreground" /> {label}
        </span>
        <span className={cn("text-lg font-bold tracking-tight tabular-nums", tone === "warn" && "text-amber-500")}>
          {value}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}
