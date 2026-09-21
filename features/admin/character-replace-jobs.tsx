"use client";

import { useMemo, useState } from "react";

import { CharacterReplaceJobActions } from "@/features/admin/character-replace-job-actions";
import { summarizeCharacterReplaceJobs, type CharacterReplaceAdminJob } from "@/lib/ai/admin-job-view";
import { replacementModeLabel } from "@/lib/ai/character-replace/modes";
import { cn } from "@/lib/utils";

/**
 * Character Replace jobs, for the operator (Part 4, §29 → 0166 §17): the
 * job, its batch and position, the member and their plan at start, the
 * file, status, cost, prediction id, the clocks (created, started,
 * completed, how long it processed and how long it waited in line), the
 * error, the attempt. Kept under the existing AI grouping on the Overview
 * tab — not a dashboard of its own.
 *
 * Client-side only for the FILTER chips over rows the page already read
 * with the service role; nothing is fetched from the browser. Provider
 * COSTS are shown only as the operator's own estimate (§30).
 */
type Filter = "all" | "queued" | "waiting" | "processing" | "completed" | "failed" | "cancelled";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "queued", label: "Queued" },
  { id: "waiting", label: "Waiting" },
  { id: "processing", label: "Processing" },
  { id: "completed", label: "Completed" },
  { id: "failed", label: "Failed" },
  { id: "cancelled", label: "Cancelled" },
];

function matches(j: CharacterReplaceAdminJob, f: Filter): boolean {
  switch (f) {
    case "all":
      return true;
    case "queued":
      return j.status === "queued";
    case "waiting":
      return j.status === "waiting";
    case "processing":
      return j.status === "acquiring" || j.status === "processing" || j.status === "finalizing";
    case "completed":
      return j.status === "completed";
    case "failed":
      return j.status === "failed" || j.status === "expired";
    case "cancelled":
      return j.status === "cancelled" || j.status === "deleted";
  }
}

const PLAN_LABEL: Record<string, string> = { free: "Free", pro: "Pro", business: "Business", max_ai: "Max AI", admin: "Admin", guest: "Guest" };

export function CharacterReplaceJobsTable({ jobs, symbol }: { jobs: CharacterReplaceAdminJob[]; symbol: string }) {
  const sum = summarizeCharacterReplaceJobs(jobs);
  const [filter, setFilter] = useState<Filter>("all");
  const shown = useMemo(() => jobs.filter((j) => matches(j, filter)), [filter, jobs]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, jobs.filter((j) => matches(j, f.id)).length])) as Record<Filter, number>, [jobs]);
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
  return (
    <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
      <h2 className="mb-1 font-semibold">Character Replace jobs</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        The last {jobs.length} jobs. A charge shows as refunded when its ledger row came back — the ledger, not the status, is the truth. &ldquo;Waiting&rdquo; is a
        paid video in the member&apos;s own line (the multi-video queue). Recovery actions ask for a reason and are written to the job&apos;s audit log.
      </p>
      {/* Part 5, §35 — the glance */}
      <dl className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-10">
        <Stat label="Active" value={sum.active} />
        <Stat label="Queued" value={sum.queued} />
        <Stat label="Waiting" value={sum.waiting} />
        <Stat label="Processing" value={sum.processing} />
        <Stat label="Finalizing" value={sum.finalizing} />
        <Stat label="Retrying" value={sum.retrying} tone={sum.retrying > 0 ? "warn" : undefined} />
        <Stat label="Stuck" value={sum.stuck} tone={sum.stuck > 0 ? "bad" : undefined} />
        <Stat label="Done 24h" value={sum.completed24h} tone="good" />
        <Stat label="Failed 24h" value={sum.failed24h} tone={sum.failed24h > 0 ? "bad" : undefined} />
        <Stat label="Refunds 24h" value={sum.refunded24h} />
      </dl>
      {/* 0166 §17 — the filters */}
      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Filter jobs">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              "min-h-[36px] rounded-full border px-3 text-[12px] font-semibold tabular-nums transition-colors",
              filter === f.id ? "border-foreground bg-foreground text-background" : "border-border/70 bg-background text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label} <span className={cn("ml-1", filter === f.id ? "opacity-70" : "opacity-60")}>{counts[f.id]}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">{jobs.length === 0 ? "No Character Replace jobs yet." : "No jobs match this filter."}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[96rem] text-left text-xs">
            <thead className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              <tr>
                <th className="py-2 pr-3 font-semibold">Job</th>
                <th className="py-2 pr-3 font-semibold">Batch</th>
                <th className="py-2 pr-3 font-semibold">Status</th>
                <th className="py-2 pr-3 font-semibold">File</th>
                <th className="py-2 pr-3 font-semibold">Member · plan</th>
                <th className="py-2 pr-3 font-semibold">Mode · stage</th>
                <th className="py-2 pr-3 font-semibold">Quality</th>
                <th className="py-2 pr-3 font-semibold">Length</th>
                <th className="py-2 pr-3 font-semibold">Charged</th>
                <th className="py-2 pr-3 font-semibold">Prediction</th>
                <th className="py-2 pr-3 font-semibold">Created</th>
                <th className="py-2 pr-3 font-semibold">Started</th>
                <th className="py-2 pr-3 font-semibold">Completed</th>
                <th className="py-2 pr-3 font-semibold">Took · waited</th>
                <th className="py-2 pr-3 font-semibold">Failure</th>
                <th className="py-2 pr-3 font-semibold">Finalize</th>
                <th className="py-2 pr-3 font-semibold">Push</th>
                <th className="py-2 font-semibold">Recover</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {shown.map((j) => {
                const took = j.startedAt && j.completedAt ? Math.round((Date.parse(j.completedAt) - Date.parse(j.startedAt)) / 1000) : null;
                return (
                  <tr key={j.id} className="align-top">
                    <td className="py-2 pr-3 font-mono text-[11px] text-muted-foreground" title={j.id}>
                      {j.id.slice(0, 8)}
                      {j.attempt > 1 ? <span className="ml-1 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-foreground" title="Retry attempt">#{j.attempt}</span> : null}
                    </td>
                    <td className="py-2 pr-3 font-mono text-[11px] text-muted-foreground" title={j.batchId ?? undefined}>
                      {j.batchId ? (
                        <>
                          {j.batchId.slice(0, 8)}
                          <span className="ml-1 text-foreground">{j.batchIndex ?? "?"}{j.batchSize ? `/${j.batchSize}` : ""}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {j.stuck ? <span className="mr-1 rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-600">stuck</span> : null}
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          j.status === "completed"
                            ? "bg-emerald-500/10 text-emerald-600"
                            : j.status === "failed"
                              ? "bg-rose-500/10 text-rose-600"
                              : j.status === "cancelled" || j.status === "expired"
                                ? "bg-secondary text-muted-foreground"
                                : j.status === "waiting"
                                  ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                                  : "bg-primary/10 text-primary",
                        )}
                      >
                        {j.status}
                      </span>
                      {j.billing === "FREE_TRIAL" ? <span className="ml-1 text-[10px] font-semibold text-muted-foreground">complimentary</span> : null}
                    </td>
                    <td className="max-w-[12rem] truncate py-2 pr-3 text-[11px]" title={j.fileName ?? undefined}>
                      {j.fileName ?? "—"}
                    </td>
                    <td className="py-2 pr-3 font-mono text-[11px] text-muted-foreground">
                      {j.userId ? j.userId.slice(0, 8) : "—"}
                      {j.audience ? <span className="ml-1 rounded-full bg-secondary px-1.5 py-0.5 font-sans text-[10px] font-semibold text-foreground">{PLAN_LABEL[j.audience] ?? j.audience}</span> : null}
                    </td>
                    <td className="py-2 pr-3 text-[11px]" title={j.model ?? undefined}>
                      <span className="font-semibold">{replacementModeLabel(j.mode)}</span>
                      {j.stage ? <span className="ml-1 rounded-full bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{j.stage}</span> : null}
                      {j.voiceSource ? <span className="ml-1 text-muted-foreground">{j.voiceSource === "tts" ? "voice: text" : "voice: upload"}</span> : null}
                      {j.lipSyncMode ? <span className="ml-1 text-muted-foreground">· {j.lipSyncMode} lip sync</span> : null}
                      {j.model ? <span className="block font-mono text-[10px] text-muted-foreground/80">{j.model}</span> : null}
                    </td>
                    <td className="py-2 pr-3">{j.quality ?? "—"}</td>
                    <td className="py-2 pr-3 tabular-nums">
                      {j.durationMs !== null ? `${(j.durationMs / 1000).toFixed(1)} s` : "—"}
                      {j.trimmed ? <span className="ml-1 text-muted-foreground">(trimmed)</span> : null}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      {j.chargedCents !== null ? `${symbol}${(j.chargedCents / 100).toFixed(2)}` : "—"}
                      {j.refunded ? <span className="ml-1 font-semibold text-amber-600">refunded</span> : null}
                      {j.rateCents !== null ? <span className="block text-[10px] text-muted-foreground">{`${symbol}${(j.rateCents / 100).toFixed(2)}/s`}</span> : null}
                      {j.providerCostUsdCents !== null ? (
                        <span className="block text-[10px] text-muted-foreground" title="Operator's estimate of the provider bill">{`est. provider $${(j.providerCostUsdCents / 100).toFixed(2)}`}</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 font-mono text-[11px] text-muted-foreground" title={j.modelVersion ?? undefined}>
                      {j.predictionId ? j.predictionId.slice(0, 10) : "—"}
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-muted-foreground" title={j.createdAt}>{when(j.createdAt)}</td>
                    <td className="py-2 pr-3 tabular-nums text-muted-foreground" title={j.startedAt ?? undefined}>{when(j.startedAt)}</td>
                    <td className="py-2 pr-3 tabular-nums text-muted-foreground" title={j.completedAt ?? undefined}>{when(j.completedAt)}</td>
                    <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                      {took !== null ? `${took}s` : "—"}
                      {j.waitedMs !== null ? <span className="block text-[10px]" title="Time in the member's queue before admission">waited {Math.round(j.waitedMs / 1000)}s</span> : null}
                    </td>
                    <td className="py-2 pr-3">
                      {j.errorCode ? (
                        <span className="font-mono text-[11px]">
                          {j.errorCode}
                          {j.failureCategory ? <span className="ml-1 text-muted-foreground">({j.failureCategory})</span> : null}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 pr-3 text-[11px]" title={j.finalizeError ?? undefined}>
                      {j.finalizeAttempts > 0 ? `${j.finalizeAttempts} attempt${j.finalizeAttempts === 1 ? "" : "s"}` : "—"}
                      {j.finalizeMs !== null ? <span className="ml-1 text-muted-foreground">{Math.round(j.finalizeMs / 1000)}s</span> : null}
                      {j.finalizeNextAt && j.status === "finalizing" ? (
                        <span className="ml-1 text-amber-600">retry {new Date(j.finalizeNextAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-[11px]">
                      {j.notifiedAt ? (
                        <span className="text-emerald-600" title={j.notifiedAt}>
                          sent
                        </span>
                      ) : j.notifyPending ? (
                        <span className="text-amber-600">pending</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2">
                      <CharacterReplaceJobActions job={j} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "good" | "warn" | "bad" }) {
  return (
    <div className="rounded-2xl border border-border/60 px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 text-lg font-bold tabular-nums",
          tone === "good" && "text-emerald-600",
          tone === "warn" && "text-amber-600",
          tone === "bad" && "text-rose-600",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
