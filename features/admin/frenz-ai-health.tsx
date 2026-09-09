/*
  🔴 NO ICON IMPORTS. The admin route sits exactly ON the 364 kB gzipped-JS
  ceiling `lib/perf/budget.test.ts` enforces, and adding this panel tipped it
  over. Five lucide glyphs are not worth raising a budget for — a stats panel
  reads perfectly well as numbers and labels, which is what it is.

  The tone dots below are CSS, so this panel adds no JavaScript at all.
*/

import type { AiAdminStats } from "@/lib/ai/admin-stats";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI — HEALTH, ON THE ADMIN DASHBOARD
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: "Add an AI Safety section to the existing admin dashboard
 * if the architecture supports it… Do NOT expose private user media
 * unnecessarily."
 *
 * ── 🔴 A SERVER COMPONENT, AND NO INTERVAL ANYWHERE ─────────────────────────
 *
 * This project has a standing law about `features/admin/`: never `setInterval`,
 * because an admin screen left open on a desk is a page that bills continuous
 * compute forever. So there is no `"use client"`, no polling, no refresh timer —
 * the numbers are read once when the page renders, and an operator who wants
 * newer ones reloads. That is the correct trade for a panel somebody looks at
 * twice a day.
 *
 * ── 🔴 COUNTS ONLY ──────────────────────────────────────────────────────────
 *
 * There is deliberately no job table here — no filenames, no members, no
 * prediction ids, no storage paths. `getAiAdminStats` cannot return them
 * because it never selects those columns, and this panel could not render them
 * if it wanted to. An admin screen is the easiest place in a product to
 * accidentally build a window onto private media, and the way not to do that is
 * to make it impossible rather than to remember not to.
 */
export function FrenzAIHealth({ stats }: { stats: AiAdminStats | null }) {
  if (!stats) {
    return (
      <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
        <h2 className="mb-1 flex items-center gap-2 font-semibold">
          Frenz AI health
        </h2>
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t read the job counters just now. The feature itself is unaffected — this panel
          only reads.
        </p>
      </section>
    );
  }

  /*
    🔴 THE ONE NUMBER THAT MATTERS MOST, AND WHY IT IS ALARMED.

    A completed job with no `notified_at` is a member who has a finished video
    and has not been told. A healthy system keeps this at zero: the notifier
    claims the row within seconds of the result landing.

    It is invisible everywhere else BECAUSE THE JOBS ARE SUCCEEDING — nothing
    errors, nothing retries, the dashboard is green, and the only symptom is
    people quietly not coming back. That is exactly the class of failure this
    product has been bitten by before (a digest that never arrived while cron
    reported success), so it gets a tone of its own rather than a row in a list.
  */
  const unnotifiedIsAlarming = stats.completedUnnotified > 0;

  return (
    <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        Frenz AI health
      </h2>
      <p className="mb-5 text-sm text-muted-foreground">
        Job counters only — no filenames, members or media. &ldquo;Today&rdquo; is midnight UTC, the
        same day boundary the daily allowance resets on.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Jobs today" value={stats.todayTotal} />
        <Stat label="Completed today" value={stats.todayCompleted} tone="good" />
        <Stat
          label="Failed today"
          value={stats.todayFailed}
          tone={stats.todayFailed > 0 ? "warn" : undefined}
        />
        <Stat
          label="Running now"
          value={stats.active}
          tone={stats.active > 0 ? "active" : undefined}
        />
      </div>

      <div
        className={cn(
          "mt-3 flex items-start gap-3 rounded-2xl border p-3.5",
          unnotifiedIsAlarming
            ? "border-amber-500/40 bg-amber-500/[0.06]"
            : "border-border/60 bg-secondary/30",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "mt-1.5 h-2 w-2 shrink-0 rounded-full",
            unnotifiedIsAlarming ? "bg-amber-500" : "bg-emerald-500",
          )}
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {stats.completedUnnotified} finished today without a notification
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {unnotifiedIsAlarming
              ? "These members have a finished video and have not been told. Nothing errors when this happens — the jobs succeed — so it shows up here or nowhere."
              : "Every finished job today has been announced exactly once."}
          </p>
        </div>
      </div>

      {/* The full lifetime picture, quieter, because it is context rather than
          something to act on. */}
      <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">All time</span>
        {(Object.entries(stats.byStatus) as [string, number][])
          .filter(([, n]) => n > 0)
          .map(([status, n]) => (
            <span key={status} className="tabular-nums">
              {status} <span className="font-semibold text-foreground">{n}</span>
            </span>
          ))}
        <span className="tabular-nums">
          total <span className="font-semibold text-foreground">{stats.total}</span>
        </span>
      </dl>
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "good" | "warn" | "active";
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-secondary/30 p-3">
      {/* A tone dot instead of a glyph — see the note at the top of this file
          on why this panel imports no icons. */}
      <span
        aria-hidden
        className={cn(
          "block h-1.5 w-6 rounded-full",
          tone === "good"
            ? "bg-emerald-500"
            : tone === "warn"
              ? "bg-amber-500"
              : tone === "active"
                ? "bg-primary"
                : "bg-border",
        )}
      />
      <p className="mt-2 text-xl font-bold tabular-nums leading-none">{value}</p>
      <p className="mt-1 text-[11px] font-medium text-muted-foreground">{label}</p>
    </div>
  );
}
