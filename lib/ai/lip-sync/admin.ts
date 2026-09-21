import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * AI → Lip Sync, the numbers (§13): jobs by speech source, credits consumed,
 * the provider-cost ESTIMATES split TTS / lip-sync, revenue (what was
 * settled from wallets, in the AI currency's minor units), and a gross
 * margin ONLY when both sides are in the same currency and known — never a
 * number invented from an estimate presented as fact.
 */
export interface LipSyncAdminStats {
  jobs: number;
  textJobs: number;
  audioJobs: number;
  nativeTextJobs: number;
  completed: number;
  failed: number;
  creditsConsumed: number;
  creditsRefunded: number;
  /** US cents, from the operator's estimates at Start (null components excluded). */
  ttsCostEstimateUsdCents: number;
  lipSyncCostEstimateUsdCents: number;
  totalCostEstimateUsdCents: number;
  /** Actual provider cost, US cents, where a vendor reported one (the run ledger); null when none did. */
  actualCostUsdCents: number | null;
  /** Settled wallet charges, minor units of the AI currency. */
  revenueCents: number;
  currency: string;
  /** Revenue − estimated cost, minor units, ONLY when the AI currency is USD; null otherwise (two currencies are not subtracted). */
  grossMarginCents: number | null;
  windowDays: number;
}

export async function getLipSyncAdminStats(currency: string, windowDays = 30): Promise<LipSyncAdminStats> {
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const db = createAdminClient();
  const [{ data: jobs }, { data: credits }, { data: runs }] = await Promise.all([
    db.from("ai_jobs").select("id, status, funding_source, charged_cents, metadata").eq("feature", "ai_lip_sync").gte("created_at", since).limit(1000),
    db.from("ai_credit_ledger").select("job_id, credits_consumed, credits_refunded, status").eq("feature", "ai_lip_sync").gte("created_at", since).limit(1000),
    db.from("ai_provider_runs").select("cost_actual_usd_cents").eq("feature", "ai_lip_sync").not("cost_actual_usd_cents", "is", null).gte("submitted_at", since).limit(1000),
  ]);
  const rows = (jobs ?? []) as { id: string; status: string; funding_source: string | null; charged_cents: number | null; metadata: Record<string, unknown> | null }[];
  let textJobs = 0;
  let audioJobs = 0;
  let nativeTextJobs = 0;
  let completed = 0;
  let failed = 0;
  let tts = 0;
  let lip = 0;
  let revenue = 0;
  for (const r of rows) {
    const speech = (r.metadata?.speech ?? null) as { source?: unknown; path?: unknown } | null;
    if (speech?.source === "text") {
      textJobs += 1;
      if (speech.path === "native") nativeTextJobs += 1;
    } else audioJobs += 1;
    if (r.status === "completed") {
      completed += 1;
      if (r.funding_source === "balance") revenue += r.charged_cents ?? 0;
    }
    if (r.status === "failed") failed += 1;
    const est = (r.metadata?.provider_cost_estimate ?? null) as { ttsUsdCents?: unknown; lipSyncUsdCents?: unknown } | null;
    if (typeof est?.ttsUsdCents === "number") tts += est.ttsUsdCents;
    if (typeof est?.lipSyncUsdCents === "number") lip += est.lipSyncUsdCents;
  }
  const creditRows = (credits ?? []) as { credits_consumed: number | null; credits_refunded: number | null }[];
  const actualRows = (runs ?? []) as { cost_actual_usd_cents: number | string | null }[];
  const actual = actualRows.length ? actualRows.reduce((a, r) => a + Number(r.cost_actual_usd_cents ?? 0), 0) : null;
  const total = Math.round((tts + lip) * 100) / 100;
  return {
    jobs: rows.length,
    textJobs,
    audioJobs,
    nativeTextJobs,
    completed,
    failed,
    creditsConsumed: creditRows.reduce((a, r) => a + (r.credits_consumed ?? 0), 0),
    creditsRefunded: creditRows.reduce((a, r) => a + (r.credits_refunded ?? 0), 0),
    ttsCostEstimateUsdCents: Math.round(tts * 100) / 100,
    lipSyncCostEstimateUsdCents: Math.round(lip * 100) / 100,
    totalCostEstimateUsdCents: total,
    actualCostUsdCents: actual === null ? null : Math.round(actual * 100) / 100,
    revenueCents: revenue,
    currency,
    grossMarginCents: currency === "USD" ? Math.round(revenue - total) : null,
    windowDays,
  };
}
