"use client";

import { useMemo, useState } from "react";

import type { AiCreditMonitorRow, AiPlansAdminStats } from "@/lib/ai/credits/admin";
import { formatCents } from "@/lib/ai/economy";
import { cn } from "@/lib/utils";

/**
 * The AI usage monitor (0167, brief § "ADMIN USAGE MONITOR"): who spent
 * credits on what — member, AI plan, site plan, the job and its state, the
 * feature, credits required / consumed / refunded, the day and week keys,
 * the limits and configuration version that applied. Client-side only for
 * the filter chips over rows the page already read with the service role.
 */
type Filter = "all" | "ai_pro" | "ai_max" | "free" | "pro" | "business" | "character_replace" | "processing" | "completed" | "failed" | "refunded";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "ai_pro", label: "AI Pro" },
  { id: "ai_max", label: "AI Max" },
  { id: "free", label: "Free" },
  { id: "pro", label: "Pro" },
  { id: "business", label: "Business" },
  { id: "character_replace", label: "Character Replace" },
  { id: "processing", label: "Processing" },
  { id: "completed", label: "Completed" },
  { id: "failed", label: "Failed" },
  { id: "refunded", label: "Refunded" },
];

function matches(r: AiCreditMonitorRow, f: Filter): boolean {
  switch (f) {
    case "all":
      return true;
    case "ai_pro":
    case "ai_max":
      return r.plan === f;
    case "free":
    case "pro":
    case "business":
      return (r.sitePlan ?? "free") === f;
    case "character_replace":
      return r.feature === "ai_character_replace";
    case "processing":
      return r.jobStatus === "waiting" || r.jobStatus === "acquiring" || r.jobStatus === "processing" || r.jobStatus === "finalizing" || r.jobStatus === "queued";
    case "completed":
      return r.jobStatus === "completed";
    case "failed":
      return r.jobStatus === "failed" || r.jobStatus === "expired" || r.jobStatus === "cancelled";
    case "refunded":
      return r.ledgerStatus === "released";
  }
}

const MODE_LABEL: Record<string, string> = { face_only: "Face Only", skin_face: "Face + Head", upper_body: "Upper Body", full_character: "Full Character" };

export function AiCreditsMonitor({ rows, stats, symbol }: { rows: AiCreditMonitorRow[]; stats: AiPlansAdminStats | null; symbol: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = useMemo(() => rows.filter((r) => matches(r, filter)), [filter, rows]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, rows.filter((r) => matches(r, f.id)).length])) as Record<Filter, number>, [rows]);
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
      <h2 className="mb-1 font-semibold">AI usage</h2>
      <p className="mb-4 text-sm text-muted-foreground">Credits are an internal allowance: reserved when a generation starts, consumed when it delivers, released when it does not. Provider costs stay on the job monitor (the operator&apos;s estimate).</p>
      {stats ? (
        <>
          <dl className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
            <Stat label="AI Pro" value={stats.subscribers.ai_pro} />
            <Stat label="AI Max" value={stats.subscribers.ai_max} />
            <Stat label="Active plans" value={stats.subscribers.active} tone="good" />
            <Stat label="Past due" value={stats.subscribers.pastDue} tone={stats.subscribers.pastDue ? "warn" : undefined} />
            <Stat label="Cancelled" value={stats.subscribers.canceled} />
            <Stat label="Gens 7d" value={stats.credits7d.generations} />
            <Stat label="Credits 7d" value={stats.credits7d.reserved} />
            <Stat label="Avg / gen" value={stats.credits7d.averagePerGeneration} />
            <Stat label="Refunded 7d" value={stats.credits7d.refunded} tone={stats.credits7d.refunded ? "warn" : undefined} />
          </dl>
          <div className="mb-4 grid grid-cols-1 gap-2 text-[12px] text-muted-foreground sm:grid-cols-3">
            <p>
              <span className="font-semibold text-foreground">Monthly plan revenue (list):</span> AI Pro {formatCents(stats.revenueCents.ai_pro, symbol)} · AI Max {formatCents(stats.revenueCents.ai_max, symbol)}
            </p>
            <p>
              <span className="font-semibold text-foreground">Most used (7d):</span> {stats.topModes.length ? stats.topModes.map((m) => `${MODE_LABEL[m.mode] ?? m.mode} ${m.count}`).join(" · ") : "—"}
              {stats.topQualities.length ? ` · ${stats.topQualities.map((q) => `${q.quality} ${q.count}`).join(" · ")}` : ""}
            </p>
            <p>
              <span className="font-semibold text-foreground">Conversions:</span> complimentary → plan {stats.freeToPlan} · AI Pro → AI Max {stats.proToMax}
            </p>
          </div>
        </>
      ) : null}
      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Filter usage">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)} className={cn("min-h-[36px] rounded-full border px-3 text-[12px] font-semibold tabular-nums transition-colors", filter === f.id ? "border-foreground bg-foreground text-background" : "border-border/70 bg-background text-muted-foreground hover:text-foreground")}>
            {f.label} <span className="ml-1 opacity-60">{counts[f.id]}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">{rows.length ? "No rows match this filter." : "No credits have been used yet."}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[80rem] text-left text-xs">
            <thead className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              <tr>
                <th className="py-2 pr-3 font-semibold">When</th>
                <th className="py-2 pr-3 font-semibold">Member · plans</th>
                <th className="py-2 pr-3 font-semibold">Job</th>
                <th className="py-2 pr-3 font-semibold">Feature</th>
                <th className="py-2 pr-3 font-semibold">Required</th>
                <th className="py-2 pr-3 font-semibold">Consumed</th>
                <th className="py-2 pr-3 font-semibold">Refunded</th>
                <th className="py-2 pr-3 font-semibold">Ledger</th>
                <th className="py-2 pr-3 font-semibold">Job status</th>
                <th className="py-2 pr-3 font-semibold">Day · week</th>
                <th className="py-2 pr-3 font-semibold">Limits · v</th>
                <th className="py-2 font-semibold">Subscription</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {shown.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="py-2 pr-3 tabular-nums text-muted-foreground" title={r.at}>{when(r.at)}</td>
                  <td className="py-2 pr-3">
                    <span className="font-mono text-[11px] text-muted-foreground">{r.userId.slice(0, 8)}</span>
                    <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">{r.plan === "ai_max" ? "AI Max" : "AI Pro"}</span>
                    <span className="ml-1 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-semibold">{r.sitePlan ?? "free"}</span>
                  </td>
                  <td className="py-2 pr-3 font-mono text-[11px] text-muted-foreground" title={r.jobId}>
                    {r.jobId.slice(0, 8)}
                    {r.mode ? <span className="block font-sans text-[10.5px]">{MODE_LABEL[r.mode] ?? r.mode}{r.quality ? ` · ${r.quality}` : ""}{r.durationMs ? ` · ${(r.durationMs / 1000).toFixed(1)}s` : ""}</span> : null}
                  </td>
                  <td className="py-2 pr-3">{r.feature === "ai_character_replace" ? "Character Replace" : r.feature}</td>
                  <td className="py-2 pr-3 font-semibold tabular-nums">{r.creditsRequired}</td>
                  <td className="py-2 pr-3 tabular-nums">{r.creditsConsumed}</td>
                  <td className="py-2 pr-3 tabular-nums">{r.creditsRefunded}</td>
                  <td className="py-2 pr-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", r.ledgerStatus === "settled" ? "bg-emerald-500/10 text-emerald-600" : r.ledgerStatus === "released" ? "bg-amber-500/10 text-amber-700" : "bg-primary/10 text-primary")}>{r.ledgerStatus}</span>
                    {r.reason ? <span className="block text-[10px] text-muted-foreground">{r.reason}</span> : null}
                  </td>
                  <td className="py-2 pr-3">{r.jobStatus ?? "—"}</td>
                  <td className="py-2 pr-3 font-mono text-[11px] text-muted-foreground">{r.dayKey} · {r.weekKey}</td>
                  <td className="py-2 pr-3 tabular-nums text-muted-foreground">{r.dailyLimit ?? "—"} / {r.weeklyLimit ?? "—"} · v{r.configVersion ?? "—"}</td>
                  <td className="py-2">{r.subscriptionStatus ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "good" | "warn" }) {
  return (
    <div className="rounded-2xl border border-border/60 px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 text-lg font-bold tabular-nums", tone === "good" && "text-emerald-600", tone === "warn" && "text-amber-600")}>{value}</dd>
    </div>
  );
}
