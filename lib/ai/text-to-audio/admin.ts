import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The numbers behind AI → Text to Audio: how many generations, how many
 * characters, how much of it the monthly free allowance covered, what was
 * charged, what the operator's cost estimate says — and the Audio Library's
 * size. A window of days, one page each, because the AI monitor is read by
 * hand and a backlog is itself the signal.
 */
export interface TextToAudioAdminStats {
  jobs: number;
  completed: number;
  failed: number;
  characters: number;
  freeCharacters: number;
  billableCharacters: number;
  creditsConsumed: number;
  creditsRefunded: number;
  revenueCents: number;
  currency: string;
  costEstimateUsdCents: number;
  actualCostUsdCents: number | null;
  grossMarginCents: number | null;
  assets: number;
  assetBytes: number;
  freeMembersThisMonth: number;
  windowDays: number;
}

export async function getTextToAudioAdminStats(currency: string, windowDays = 30): Promise<TextToAudioAdminStats> {
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const db = createAdminClient();
  const [{ data: jobs }, { data: credits }, { data: runs }, { data: assets }, { data: free }] = await Promise.all([
    db.from("ai_jobs").select("id, status, funding_source, charged_cents, metadata").eq("feature", "ai_text_to_audio").gte("created_at", since).limit(1000),
    db.from("ai_credit_ledger").select("credits_consumed, credits_refunded").eq("feature", "ai_text_to_audio").gte("created_at", since).limit(1000),
    db.from("ai_provider_runs").select("cost_actual_usd_cents").eq("feature", "ai_text_to_audio").not("cost_actual_usd_cents", "is", null).gte("submitted_at", since).limit(1000),
    db.from("ai_audio_assets").select("bytes").is("deleted_at", null).limit(1000),
    db.from("ai_tta_free_usage").select("user_id, used").gte("used", 1).limit(1000),
  ]);
  const rows = (jobs ?? []) as { status: string; funding_source: string | null; charged_cents: number | null; metadata: Record<string, unknown> | null }[];
  let characters = 0;
  let freeCharacters = 0;
  let completed = 0;
  let failed = 0;
  let revenue = 0;
  let cost = 0;
  for (const r of rows) {
    const chars = Number((r.metadata?.characters as number | undefined) ?? 0) || 0;
    characters += chars;
    const covered = Number(((r.metadata?.free_characters ?? null) as { covered?: number } | null)?.covered ?? 0) || 0;
    freeCharacters += covered;
    if (r.status === "completed") {
      completed += 1;
      if (r.funding_source === "balance") revenue += r.charged_cents ?? 0;
    }
    if (r.status === "failed") failed += 1;
    const est = Number(((r.metadata?.provider_cost_estimate ?? null) as { totalUsdCents?: number } | null)?.totalUsdCents ?? 0) || 0;
    cost += est;
  }
  const creditRows = (credits ?? []) as { credits_consumed: number | null; credits_refunded: number | null }[];
  const actualRows = (runs ?? []) as { cost_actual_usd_cents: number | string | null }[];
  const actual = actualRows.length ? actualRows.reduce((a, r) => a + Number(r.cost_actual_usd_cents ?? 0), 0) : null;
  const assetRows = (assets ?? []) as { bytes: number | null }[];
  const freeRows = (free ?? []) as { user_id: string }[];
  const estimate = Math.round(cost * 100) / 100;
  return {
    jobs: rows.length,
    completed,
    failed,
    characters,
    freeCharacters,
    billableCharacters: Math.max(0, characters - freeCharacters),
    creditsConsumed: creditRows.reduce((a, r) => a + (r.credits_consumed ?? 0), 0),
    creditsRefunded: creditRows.reduce((a, r) => a + (r.credits_refunded ?? 0), 0),
    revenueCents: revenue,
    currency,
    costEstimateUsdCents: estimate,
    actualCostUsdCents: actual === null ? null : Math.round(actual * 100) / 100,
    grossMarginCents: currency === "USD" ? Math.round(revenue - estimate) : null,
    assets: assetRows.length,
    assetBytes: assetRows.reduce((a, r) => a + (r.bytes ?? 0), 0),
    freeMembersThisMonth: new Set(freeRows.map((r) => r.user_id)).size,
    windowDays,
  };
}
