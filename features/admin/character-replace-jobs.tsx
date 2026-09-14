import type { CharacterReplaceAdminJob } from "@/lib/ai/admin-stats";
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
  return (
    <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
      <h2 className="mb-1 font-semibold">Character Replace jobs</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        The last {jobs.length} jobs. A charge shows as refunded when its ledger row came back — the ledger, not the status, is the truth.
      </p>
      {jobs.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">No Character Replace jobs yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-left text-xs">
            <thead className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              <tr>
                <th className="py-2 pr-3 font-semibold">When</th>
                <th className="py-2 pr-3 font-semibold">Status</th>
                <th className="py-2 pr-3 font-semibold">Quality</th>
                <th className="py-2 pr-3 font-semibold">Length</th>
                <th className="py-2 pr-3 font-semibold">Charged</th>
                <th className="py-2 pr-3 font-semibold">Failure</th>
                <th className="py-2 pr-3 font-semibold">Prediction</th>
                <th className="py-2 pr-3 font-semibold">Member</th>
                <th className="py-2 font-semibold">Took</th>
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
                    <td className="py-2 pr-3">{j.quality ?? "—"}</td>
                    <td className="py-2 pr-3 tabular-nums">
                      {j.durationMs !== null ? `${(j.durationMs / 1000).toFixed(1)} s` : "—"}
                      {j.trimmed ? <span className="ml-1 text-muted-foreground">(trimmed)</span> : null}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      {j.chargedCents !== null ? `${symbol}${(j.chargedCents / 100).toFixed(2)}` : "—"}
                      {j.refunded ? <span className="ml-1 font-semibold text-amber-600">refunded</span> : null}
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
                    <td className="py-2 tabular-nums text-muted-foreground">{took !== null ? `${took}s` : "—"}</td>
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
