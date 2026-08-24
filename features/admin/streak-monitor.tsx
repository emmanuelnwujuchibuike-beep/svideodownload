import { Bell, Flame, RotateCcw, Trophy, UserRound, Users } from "lucide-react";

import type { StreakAdminMetrics } from "@/lib/streaks/admin";
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
export function StreakMonitor({ metrics }: { metrics: StreakAdminMetrics }) {
  const retention2 = pct(metrics.streaks2Plus, metrics.activeStreaks);
  const retention7 = pct(metrics.streaks7Plus, metrics.activeStreaks);

  return (
    <section className="mt-6 overflow-hidden rounded-3xl border border-border/70 bg-card p-6 shadow-card">
      <h2 className="mb-5 flex items-center gap-2 font-semibold">
        <Flame className="h-5 w-5 text-orange-500" /> Streaks
      </h2>

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
