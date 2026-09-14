import { CharacterReplaceJobActions } from "@/features/admin/character-replace-job-actions";
import { summarizeCharacterReplaceJobs, type CharacterReplaceAdminJob } from "@/lib/ai/admin-stats";
import { cn } from "@/lib/utils";

/**
 * Character Replace jobs, for the operator (Part 4, §29): processing status,
 * provider state, duration, quality, price charged, refunds, failures, the
 * prediction id and the timestamps. Kept under the existing AI grouping as a
 * table on the Overview tab — not a dashboard of its own.
 *
 * Server-rendered, no icons, no client state: the page reads it once with
 * the service role and prints it. Provider COSTS are never here (§30).
 */
export function CharacterReplaceJobsTable({ jobs, symbol }: { jobs: CharacterReplaceAdminJob[]; symbol: string }) {
  const sum = summarizeCharacterReplaceJobs(jobs);
  return (
    <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
      <h2 className="mb-1 font-semibold">Character Replace jobs</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        The last {jobs.length} jobs. A charge shows as refunded when its ledger row came back — the ledger, not the status, is the truth.
        Recovery actions ask for a reason and are written to the job&apos;s audit log.
      </p>
      {/* Part 5, §35 — the glance */}
      <dl className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
        <Stat label="Active" value={sum.active} />
        <Stat label="Queued" value={sum.queued} />
        <Stat label="Processing" value={sum.processing} />
        <Stat label="Finalizing" value={sum.finalizing} />
        <Stat label="Retrying" value={sum.retrying} tone={sum.retrying > 0 ? "warn" : undefined} />
        <Stat label="Stuck" value={sum.stuck} tone={sum.stuck > 0 ? "bad" : undefined} />
        <Stat label="Done 24h" value={sum.completed24h} tone="good" />
        <Stat label="Failed 24h" value={sum.failed24h} tone={sum.failed24h > 0 ? "bad" : undefined} />
        <Stat label="Refunds 24h" value={sum.refunded24h} />
      </dl>
      {jobs.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">No Character Replace jobs yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[78rem] text-left text-xs">
            <thead className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              <tr>
                <th className="py-2 pr-3 font-semibold">When</th>
                <th className="py-2 pr-3 font-semibold">Status</th>
                <th className="py-2 pr-3 font-semibold">Mode · stage</th>
                <th className="py-2 pr-3 font-semibold">Quality</th>
                <th className="py-2 pr-3 font-semibold">Length</th>
                <th className="py-2 pr-3 font-semibold">Charged</th>
                <th className="py-2 pr-3 font-semibold">Failure</th>
                <th className="py-2 pr-3 font-semibold">Prediction</th>
                <th className="py-2 pr-3 font-semibold">Member</th>
                <th className="py-2 pr-3 font-semibold">Took</th>
                <th className="py-2 pr-3 font-semibold">Finalize</th>
                <th className="py-2 pr-3 font-semibold">Push</th>
                <th className="py-2 font-semibold">Recover</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {jobs.map((j) => {
                const took = j.startedAt && j.completedAt ? Math.round((Date.parse(j.completedAt) - Date.parse(j.startedAt)) / 1000) : null;
                return (
                  <tr key={j.id} className="align-top">
                    <td className="py-2 pr-3 tabular-nums text-muted-foreground" title={j.createdAt}>
                      {new Date(j.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="py-2 pr-3">
                      {j.stuck ? <span className="mr-1 rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-600">stuck</span> : null}
                      {j.attempt > 1 ? <span className="mr-1 text-[10px] text-muted-foreground">#{j.attempt}</span> : null}
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          j.status === "completed"
                            ? "bg-emerald-500/10 text-emerald-600"
                            : j.status === "failed"
                              ? "bg-rose-500/10 text-rose-600"
                              : j.status === "cancelled" || j.status === "expired"
                                ? "bg-secondary text-muted-foreground"
                                : "bg-primary/10 text-primary",
                        )}
                      >
                        {j.status}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-[11px]" title={j.model ?? undefined}>
                      <span className="font-semibold">{j.mode === "face_only" ? "Face Only" : j.mode === "skin_face" ? "Skin + Face" : "Full Character"}</span>
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
                    <td className="py-2 pr-3 font-mono text-[11px] text-muted-foreground" title={j.modelVersion ?? undefined}>
                      {j.predictionId ? j.predictionId.slice(0, 10) : "—"}
                    </td>
                    <td className="py-2 pr-3 font-mono text-[11px] text-muted-foreground">{j.userId ? j.userId.slice(0, 8) : "—"}</td>
                    <td className="py-2 pr-3 tabular-nums text-muted-foreground">{took !== null ? `${took}s` : "—"}</td>
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
