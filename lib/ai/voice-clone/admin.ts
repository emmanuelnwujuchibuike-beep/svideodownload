import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The numbers behind AI → Voice Cloning: how many voices were made, how many
 * are alive right now (which is what fills the provider account's slots), how
 * many the monthly allowance covered, what was charged, and how many are dead
 * weight — a voice nobody has spoken with since it was made is a slot the
 * operator can reclaim.
 *
 * 🔴 `liveVoices` against the configured `accountVoiceCap` is the one figure to
 * watch. When it fills, every member is refused at once, and the refusal is not
 * anybody's mistake — so it needs to be visible before it happens rather than
 * discovered from a support message.
 */
export interface VoiceCloneAdminStats {
  jobs: number;
  completed: number;
  failed: number;
  rejected: number;
  freeVoices: number;
  creditsConsumed: number;
  creditsRefunded: number;
  revenueCents: number;
  currency: string;
  costEstimateUsdCents: number;
  /** Alive now: every member's `pending` and `ready` rows. This is what occupies provider slots. */
  liveVoices: number;
  /** Alive and never spoken with. */
  unusedVoices: number;
  /** Alive, and last spoken with more than 30 days ago. */
  staleVoices: number;
  members: number;
  sampleBytes: number;
  freeMembersThisMonth: number;
  windowDays: number;
}

export async function getVoiceCloneAdminStats(currency: string, windowDays = 30): Promise<VoiceCloneAdminStats> {
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const staleBefore = Date.now() - 30 * 86_400_000;
  const db = createAdminClient();
  const [{ data: jobs }, { data: credits }, { data: clones }, { data: free }] = await Promise.all([
    db.from("ai_jobs").select("id, status, funding_source, charged_cents, error_code, metadata").eq("feature", "ai_voice_clone").gte("created_at", since).limit(1000),
    db.from("ai_credit_ledger").select("credits_consumed, credits_refunded").eq("feature", "ai_voice_clone").gte("created_at", since).limit(1000),
    // every LIVE voice, not only this window's: a slot from three months ago is still a slot
    db.from("ai_voice_clones").select("user_id, status, sample_bytes, created_at, last_used_at").in("status", ["pending", "ready"]).is("deleted_at", null).limit(1000),
    db.from("ai_vc_free_usage").select("user_id, used").gte("used", 1).limit(1000),
  ]);
  const rows = (jobs ?? []) as { status: string; funding_source: string | null; charged_cents: number | null; error_code: string | null; metadata: Record<string, unknown> | null }[];
  let completed = 0;
  let failed = 0;
  let rejected = 0;
  let freeVoices = 0;
  let revenue = 0;
  let cost = 0;
  for (const r of rows) {
    if (r.status === "completed") {
      completed += 1;
      if (r.funding_source === "balance") revenue += r.charged_cents ?? 0;
    }
    if (r.status === "failed") {
      failed += 1;
      // the samples were the problem, rather than us — the figure the operator can act on by improving the guidance
      if (r.error_code === "VOICE_CLONE_REJECTED") rejected += 1;
    }
    if ((Number(((r.metadata?.free_clones ?? null) as { covered?: number } | null)?.covered ?? 0) || 0) > 0) freeVoices += 1;
    cost += Number(((r.metadata?.provider_cost_estimate ?? null) as { totalUsdCents?: number } | null)?.totalUsdCents ?? 0) || 0;
  }
  const creditRows = (credits ?? []) as { credits_consumed: number | null; credits_refunded: number | null }[];
  const cloneRows = (clones ?? []) as { user_id: string; sample_bytes: number | null; last_used_at: string | null }[];
  const freeRows = (free ?? []) as { user_id: string }[];
  return {
    jobs: rows.length,
    completed,
    failed,
    rejected,
    freeVoices,
    creditsConsumed: creditRows.reduce((a, r) => a + (r.credits_consumed ?? 0), 0),
    creditsRefunded: creditRows.reduce((a, r) => a + (r.credits_refunded ?? 0), 0),
    revenueCents: revenue,
    currency,
    costEstimateUsdCents: Math.round(cost * 100) / 100,
    liveVoices: cloneRows.length,
    unusedVoices: cloneRows.filter((c) => !c.last_used_at).length,
    staleVoices: cloneRows.filter((c) => c.last_used_at && Date.parse(c.last_used_at) < staleBefore).length,
    members: new Set(cloneRows.map((c) => c.user_id)).size,
    sampleBytes: cloneRows.reduce((a, c) => a + (c.sample_bytes ?? 0), 0),
    freeMembersThisMonth: new Set(freeRows.map((r) => r.user_id)).size,
    windowDays,
  };
}
