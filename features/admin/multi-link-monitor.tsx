"use client";

import { Layers } from "lucide-react";

import type { MultiLinkStats } from "@/lib/monetization/multilink-stats";
import { cn } from "@/lib/utils";

/**
 * Admin → Multi-Link activity (owner, 2026-08-25: "add the multi link ad
 * monitor activity in the admin dashboard like the others … show where an ad
 * was shown and how many reward ad from multi download, and how many users
 * used up their free multi download and how many did not").
 *
 * ── Every figure here is counted, none is estimated ───────────────────────
 * Sources: the `events` table and `ad_impressions`. Where something genuinely
 * cannot be counted it says so in words rather than showing a plausible
 * number — the standing no-fabricated-stats rule applies to an admin panel
 * exactly as it does to a marketing page, and arguably more, because this is
 * the screen decisions get made from.
 */

const REFUSAL_LABELS: Record<string, string> = {
  DAILY_LIMIT_REACHED: "Daily allowance spent",
  TOO_MANY_SOURCES: "Over the source limit",
  TOO_MANY_ITEMS: "Over the item limit",
  FEATURE_DISABLED: "Feature switched off",
};

export function MultiLinkMonitor({ stats }: { stats: MultiLinkStats }) {
  const totalRefused = Object.values(stats.refusedByReason).reduce((n, v) => n + v, 0);
  const totalImpressions = stats.adImpressions.betweenSources + stats.adImpressions.fetchGate;
  const rewardCompletion =
    stats.rewards.started > 0
      ? Math.round((stats.rewards.granted / stats.rewards.started) * 100)
      : null;
  const avgSources =
    stats.authorized > 0 ? (stats.totalSources / stats.authorized).toFixed(1) : null;
  const avgItems = stats.authorized > 0 ? (stats.totalItems / stats.authorized).toFixed(1) : null;
  const nothingYet = stats.authorized === 0 && stats.started === 0 && totalRefused === 0;

  return (
    <section className="mt-6 rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Layers className="h-5 w-5 text-primary" /> Multi-Link activity
        </h2>
        <p className="text-xs text-muted-foreground">
          Last {stats.rangeDays} days
          {stats.capped ? " · partial window (row cap reached)" : ""}
        </p>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Batch downloads across multiple source links — usage, the limits that bit, and what the two
        Multi-Link ad placements earned.
      </p>

      {nothingYet ? (
        /* An empty state that says so, rather than a wall of zeroes that reads
           as a broken panel. */
        <p className="rounded-2xl border border-dashed border-border/70 bg-secondary/20 px-4 py-6 text-center text-sm text-muted-foreground">
          No Multi-Link batches recorded in this window yet.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Batches run" value={stats.started} hint="Spent an allowance and downloaded" />
            <Stat label="Authorized" value={stats.authorized} hint="Passed every server check" />
            <Stat
              label="Refused"
              value={totalRefused}
              hint="A server-side limit bit"
              tone={totalRefused > 0 ? "warn" : undefined}
            />
            <Stat label="Members" value={stats.users} hint="Distinct signed-in users" />
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {/* ── Who has run out ───────────────────────────────────────── */}
            <Card title="Free allowance today">
              <Row label={`Used all ${stats.freeDailyLimit} today`} value={stats.usedUpToday} />
              <Row label="Ran a batch, still have some left" value={stats.remainingToday} />
              <Row
                label="Refused for a spent allowance"
                value={stats.refusedByReason.DAILY_LIMIT_REACHED ?? 0}
                hint="Over the whole window, not just today"
              />
              {/*
                🔴 The one real attribution limit, stated instead of hidden.
                The allowance is keyed per identity, and a signed-out visitor's
                identity is their IP hash — deliberately never written to the
                events table. So their batches are counted in the totals above
                but cannot be grouped per person here.
              */}
              <p className="mt-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                Signed-in members only. {stats.anonymousBatches.toLocaleString()} batch
                {stats.anonymousBatches === 1 ? "" : "es"} came from signed-out visitors, who are
                counted by IP and can&apos;t be grouped per person here.
              </p>
            </Card>

            {/* ── Where an ad was shown ─────────────────────────────────── */}
            <Card title="Ads shown in Multi-Link">
              <Row label="Between source cards" value={stats.adImpressions.betweenSources} />
              <Row label="After fetching (vignette)" value={stats.adImpressions.fetchGate} />
              <Row label="Total impressions" value={totalImpressions} strong />
              <div className="mt-2 border-t border-border/60 pt-2">
                <Row label="Reward ads started" value={stats.rewards.started} />
                <Row
                  label="Reward ads completed"
                  value={stats.rewards.granted}
                  hint={rewardCompletion === null ? undefined : `${rewardCompletion}% completion`}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Reward figures are the Multi-Link gate only — the single-link batch gate opens the
                same reward type, so these are separated by surface, not by type.
              </p>
            </Card>
          </div>

          {/* ── Which limit bit ──────────────────────────────────────────── */}
          {totalRefused > 0 ? (
            <Card title="Refusals by reason" className="mt-3">
              {Object.entries(stats.refusedByReason)
                .sort((a, b) => b[1] - a[1])
                .map(([reason, count]) => (
                  <Row key={reason} label={REFUSAL_LABELS[reason] ?? reason} value={count} />
                ))}
              <p className="mt-2 text-xs text-muted-foreground">
                A refusal is unmet intent — someone tried to batch and was stopped. The daily-limit
                row is the upgrade case.
              </p>
            </Card>
          ) : null}

          {/* ── The shape of real use ────────────────────────────────────── */}
          {avgSources ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Average batch: <span className="font-semibold text-foreground">{avgSources}</span>{" "}
              sources and <span className="font-semibold text-foreground">{avgItems}</span> items,
              across {stats.authorized.toLocaleString()} authorized batch
              {stats.authorized === 1 ? "" : "es"}.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "warn";
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/50 p-3">
      <p
        className={cn(
          "text-2xl font-extrabold tabular-nums",
          tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-foreground",
        )}
      >
        {value.toLocaleString()}
      </p>
      <p className="mt-0.5 text-xs font-medium text-foreground">{label}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Card({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-2xl border border-border/70 bg-secondary/25 p-4", className)}>
      <p className="mb-2 text-sm font-bold">{title}</p>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: number;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className={cn("text-sm", strong ? "font-semibold text-foreground" : "text-muted-foreground")}>
        {label}
        {hint ? <span className="ml-1.5 text-[11px] text-muted-foreground">· {hint}</span> : null}
      </span>
      <span className={cn("shrink-0 tabular-nums", strong ? "text-base font-extrabold" : "text-sm font-semibold")}>
        {value.toLocaleString()}
      </span>
    </div>
  );
}
