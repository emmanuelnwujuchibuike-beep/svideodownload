import "server-only";

import type { AiVendor } from "@/lib/ai/providers/config";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE PROVIDER-RUN LEDGER — one row per provider request (0168)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * §19 provider economics, §20 the comparison dashboard, §26 provider health
 * and §27 the admin test all read from `ai_provider_runs`. A row is opened
 * when a request is ACCEPTED by a provider (submit), closed when the webhook
 * or the reconciler learns the outcome, and every write is keyed on
 * (provider, provider_job_id), which is unique — a duplicate webhook or a
 * second reconcile pass updates the same row and never creates another.
 *
 * Best-effort throughout: the ledger describes the job, it never decides it.
 * A write that fails is logged and the job proceeds.
 */

export type ProviderRunStatus = "submitted" | "processing" | "succeeded" | "failed" | "cancelled" | "timeout";

export interface OpenProviderRun {
  jobId: string | null;
  userId: string | null;
  feature: string;
  mode?: string | null;
  stage?: string | null;
  provider: AiVendor;
  model: string;
  modelVersion?: string | null;
  providerJobId: string | null;
  test?: boolean;
  latencyMs?: number | null;
  inputDurationMs?: number | null;
  inputResolution?: string | null;
  /** §19: the operator's ESTIMATE, in US cents. Never written to the actual column. */
  costEstimateUsdCents?: number | null;
  metadata?: Record<string, unknown>;
  /** A test that ends at once (a credential check) can be written closed. */
  status?: ProviderRunStatus;
  errorCode?: string | null;
  errorDetail?: string | null;
}

export async function openProviderRun(run: OpenProviderRun): Promise<string | null> {
  try {
    const now = new Date().toISOString();
    const closed = run.status && run.status !== "submitted" && run.status !== "processing";
    const { data, error } = await createAdminClient()
      .from("ai_provider_runs")
      .upsert(
        {
          job_id: run.jobId,
          user_id: run.userId,
          feature: run.feature,
          mode: run.mode ?? null,
          stage: run.stage ?? null,
          provider: run.provider,
          model: run.model,
          model_version: run.modelVersion ?? null,
          provider_job_id: run.providerJobId,
          status: run.status ?? "submitted",
          test: run.test === true,
          submitted_at: now,
          ...(closed ? { completed_at: now } : {}),
          latency_ms: run.latencyMs ?? null,
          input_duration_ms: run.inputDurationMs ?? null,
          input_resolution: run.inputResolution ?? null,
          cost_estimate_usd_cents: run.costEstimateUsdCents ?? null,
          error_code: run.errorCode ?? null,
          error_detail: run.errorDetail ? run.errorDetail.slice(0, 2000) : null,
          metadata: run.metadata ?? {},
        },
        run.providerJobId ? { onConflict: "provider,provider_job_id", ignoreDuplicates: true } : undefined,
      )
      .select("id")
      .maybeSingle();
    if (error) {
      console.warn("[ai/provider-runs] open failed", { code: error.code, message: error.message, provider: run.provider, jobId: run.jobId });
      return null;
    }
    return data?.id ?? null;
  } catch (e) {
    console.warn("[ai/provider-runs] open threw", { error: String(e).slice(0, 200) });
    return null;
  }
}

/** The outcome, keyed on the provider's own id. Idempotent: a closed row is not reopened by a late "processing". */
export async function closeProviderRun(
  provider: AiVendor,
  providerJobId: string,
  outcome: { status: Exclude<ProviderRunStatus, "submitted">; errorCode?: string | null; errorDetail?: string | null; outputRef?: string | null; costActualUsdCents?: number | null; startedAt?: string | null; metadata?: Record<string, unknown> },
): Promise<void> {
  try {
    const db = createAdminClient();
    const now = new Date().toISOString();
    if (outcome.status === "processing") {
      await db.from("ai_provider_runs").update({ status: "processing", started_at: outcome.startedAt ?? now }).eq("provider", provider).eq("provider_job_id", providerJobId).eq("status", "submitted");
      return;
    }
    const patch: Record<string, unknown> = {
      status: outcome.status,
      completed_at: now,
      error_code: outcome.errorCode ?? null,
      error_detail: outcome.errorDetail ? outcome.errorDetail.slice(0, 2000) : null,
      output_ref: outcome.outputRef ? outcome.outputRef.slice(0, 500) : null,
    };
    if (typeof outcome.costActualUsdCents === "number") patch.cost_actual_usd_cents = outcome.costActualUsdCents;
    if (outcome.startedAt) patch.started_at = outcome.startedAt;
    if (outcome.metadata) patch.metadata = outcome.metadata;
    await db.from("ai_provider_runs").update(patch).eq("provider", provider).eq("provider_job_id", providerJobId).in("status", ["submitted", "processing"]);
  } catch (e) {
    console.warn("[ai/provider-runs] close threw", { error: String(e).slice(0, 200) });
  }
}

/** The most recent runs, for the admin table. */
export interface ProviderRunRow {
  id: string;
  job_id: string | null;
  user_id: string | null;
  feature: string;
  mode: string | null;
  stage: string | null;
  provider: AiVendor;
  model: string;
  model_version: string | null;
  provider_job_id: string | null;
  status: ProviderRunStatus;
  test: boolean;
  submitted_at: string;
  started_at: string | null;
  completed_at: string | null;
  latency_ms: number | null;
  input_duration_ms: number | null;
  input_resolution: string | null;
  cost_estimate_usd_cents: number | null;
  cost_actual_usd_cents: number | null;
  error_code: string | null;
  error_detail: string | null;
  output_ref: string | null;
}

const RUN_COLUMNS = "id, job_id, user_id, feature, mode, stage, provider, model, model_version, provider_job_id, status, test, submitted_at, started_at, completed_at, latency_ms, input_duration_ms, input_resolution, cost_estimate_usd_cents, cost_actual_usd_cents, error_code, error_detail, output_ref";

export async function listProviderRuns(limit = 200, opts: { days?: number } = {}): Promise<ProviderRunRow[]> {
  try {
    let q = createAdminClient().from("ai_provider_runs").select(RUN_COLUMNS).order("submitted_at", { ascending: false }).limit(Math.min(1000, limit));
    if (opts.days) q = q.gte("submitted_at", new Date(Date.now() - opts.days * 86_400_000).toISOString());
    const { data, error } = await q;
    if (error) return [];
    return (data ?? []).map((r) => ({ ...(r as unknown as ProviderRunRow), cost_estimate_usd_cents: num(r.cost_estimate_usd_cents), cost_actual_usd_cents: num(r.cost_actual_usd_cents) }));
  } catch {
    return [];
  }
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/* ───────────────────────── §20: the comparison, and §26: health ──────────── */

export interface ProviderComparisonRow {
  feature: string;
  provider: AiVendor;
  model: string;
  jobs: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  inFlight: number;
  successRate: number | null;
  /** Averages in milliseconds, over the runs that carry the timestamps; null when none do. */
  avgQueueMs: number | null;
  avgProcessingMs: number | null;
  avgTotalMs: number | null;
  avgSubmitLatencyMs: number | null;
  estimatedCostUsdCents: number;
  actualCostUsdCents: number | null;
  actualCostRuns: number;
  testRuns: number;
  /** Failure reasons, most frequent first. */
  failures: { code: string; count: number }[];
}

/**
 * Factual metrics per feature / provider / model (§20). No score, no
 * "winner": the operator compares numbers and outputs. Test runs are
 * counted separately and excluded from the rates.
 */
export function compareProviderRuns(rows: readonly ProviderRunRow[]): ProviderComparisonRow[] {
  const groups = new Map<string, ProviderRunRow[]>();
  for (const r of rows) {
    const key = `${r.feature}|${r.provider}|${r.model}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const ms = (a: string | null, b: string | null) => (a && b ? Math.max(0, Date.parse(b) - Date.parse(a)) : null);
  const out: ProviderComparisonRow[] = [];
  for (const [, all] of groups) {
    const tests = all.filter((r) => r.test);
    const runs = all.filter((r) => !r.test);
    const done = runs.filter((r) => r.status === "succeeded" || r.status === "failed" || r.status === "timeout");
    const succeeded = runs.filter((r) => r.status === "succeeded").length;
    const failed = runs.filter((r) => r.status === "failed" || r.status === "timeout").length;
    const cancelled = runs.filter((r) => r.status === "cancelled").length;
    const inFlight = runs.filter((r) => r.status === "submitted" || r.status === "processing").length;
    const queue = runs.map((r) => ms(r.submitted_at, r.started_at)).filter((v): v is number => v !== null);
    const processing = runs.map((r) => ms(r.started_at, r.completed_at)).filter((v): v is number => v !== null);
    const total = runs.filter((r) => r.status === "succeeded").map((r) => ms(r.submitted_at, r.completed_at)).filter((v): v is number => v !== null);
    const latency = runs.map((r) => r.latency_ms).filter((v): v is number => typeof v === "number");
    const actual = runs.filter((r) => typeof r.cost_actual_usd_cents === "number");
    const failures = new Map<string, number>();
    for (const r of runs) if (r.status === "failed" || r.status === "timeout") failures.set(r.error_code ?? "unknown", (failures.get(r.error_code ?? "unknown") ?? 0) + 1);
    const first = all[0]!;
    out.push({
      feature: first.feature,
      provider: first.provider,
      model: first.model,
      jobs: runs.length,
      succeeded,
      failed,
      cancelled,
      inFlight,
      successRate: done.length ? Math.round((succeeded / done.length) * 1000) / 10 : null,
      avgQueueMs: avg(queue),
      avgProcessingMs: avg(processing),
      avgTotalMs: avg(total),
      avgSubmitLatencyMs: avg(latency),
      estimatedCostUsdCents: Math.round(runs.reduce((a, r) => a + (r.cost_estimate_usd_cents ?? 0), 0) * 100) / 100,
      actualCostUsdCents: actual.length ? Math.round(actual.reduce((a, r) => a + (r.cost_actual_usd_cents ?? 0), 0) * 100) / 100 : null,
      actualCostRuns: actual.length,
      testRuns: tests.length,
      failures: [...failures.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count).slice(0, 5),
    });
  }
  return out.sort((a, b) => a.feature.localeCompare(b.feature) || a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model));
}

export interface ProviderHealthRow {
  provider: AiVendor;
  /** Credentials present on THIS deployment — never the values. */
  credentials: boolean;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  recentError: { code: string | null; detail: string | null; at: string; model: string } | null;
  runs24h: number;
  failures24h: number;
  avgSubmitLatencyMs: number | null;
}

export function providerHealthFromRuns(rows: readonly ProviderRunRow[], credentials: Record<AiVendor, boolean>): ProviderHealthRow[] {
  const vendors: AiVendor[] = ["replicate", "fal", "elevenlabs"];
  const dayAgo = Date.now() - 86_400_000;
  return vendors.map((provider) => {
    const mine = rows.filter((r) => r.provider === provider);
    const ok = mine.filter((r) => r.status === "succeeded").sort((a, b) => Date.parse(b.completed_at ?? b.submitted_at) - Date.parse(a.completed_at ?? a.submitted_at));
    const bad = mine.filter((r) => r.status === "failed" || r.status === "timeout").sort((a, b) => Date.parse(b.completed_at ?? b.submitted_at) - Date.parse(a.completed_at ?? a.submitted_at));
    const recent = mine.filter((r) => Date.parse(r.submitted_at) >= dayAgo);
    const latency = recent.map((r) => r.latency_ms).filter((v): v is number => typeof v === "number");
    const last = bad[0] ?? null;
    return {
      provider,
      credentials: credentials[provider],
      lastSuccessAt: ok[0]?.completed_at ?? ok[0]?.submitted_at ?? null,
      lastFailureAt: last?.completed_at ?? last?.submitted_at ?? null,
      recentError: last ? { code: last.error_code, detail: last.error_detail ? last.error_detail.slice(0, 200) : null, at: last.completed_at ?? last.submitted_at, model: last.model } : null,
      runs24h: recent.length,
      failures24h: recent.filter((r) => r.status === "failed" || r.status === "timeout").length,
      avgSubmitLatencyMs: latency.length ? Math.round(latency.reduce((a, b) => a + b, 0) / latency.length) : null,
    };
  });
}
