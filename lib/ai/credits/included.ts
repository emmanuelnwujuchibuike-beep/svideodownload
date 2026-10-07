import "server-only";

import { recordJobEvent } from "@/lib/ai/job-events";
import { getJobAsService } from "@/lib/ai/job-store";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  INCLUDED GENERATIONS — a feature's monthly allowance per tier (0185)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The rules are `frenzAiPlans.features.<id>.monthlyIncluded` (lib/ai/credits/
 * features.ts). This module is the only code that touches the counter, and it
 * does so through the two SQL functions only — the Text to Audio free
 * characters pattern (lib/ai/text-to-audio/free.ts), kept on purpose:
 *
 *   take     at /start, after the claim: one generation, atomic per member.
 *            The job is funded `free` and carries `metadata.included_use`.
 *   give     on any undo, ONCE: the row's `included_use.released` mark is
 *            claimed with a compare-and-set before the function runs, so the
 *            webhook, the stall sweep and cancel cannot each hand it back.
 *
 * A read that fails is "none left" — a member is never told they have an
 * included generation the server cannot take.
 */
export interface IncludedUse {
  feature: string;
  periodKey: string;
  released?: boolean;
}

export async function readIncludedUsed(userId: string, feature: string, periodKey: string): Promise<number> {
  const { data, error } = await createAdminClient().from("ai_feature_included_usage").select("used").eq("user_id", userId).eq("feature", feature).eq("period_key", periodKey).maybeSingle();
  if (error) {
    console.error("[ai/included] read failed", { userId, feature, periodKey, message: error.message });
    return Number.MAX_SAFE_INTEGER;
  }
  return Math.max(0, Number((data as { used?: unknown } | null)?.used ?? 0) || 0);
}

/** Take one included generation. True when it was taken. */
export async function consumeIncludedUse(userId: string, feature: string, periodKey: string, limit: number): Promise<boolean> {
  if (limit <= 0) return false;
  const { data, error } = await createAdminClient().rpc("consume_feature_included", { p_user_id: userId, p_feature: feature, p_period_key: periodKey, p_limit: limit });
  if (error) {
    console.error("[ai/included] consume failed", { userId, feature, periodKey, message: error.message });
    return false;
  }
  return (data as { taken?: unknown } | null)?.taken === true;
}

/** Give a job's included generation back — once, whoever calls. Answers whether this call gave it back. */
export async function releaseIncludedUseForJob(jobId: string, reason: string): Promise<boolean> {
  const row = await getJobAsService(jobId);
  if (!row || !row.user_id) return false;
  const used = (row.metadata as { included_use?: IncludedUse } | null)?.included_use;
  if (!used || used.released || !used.feature || !used.periodKey) return false;
  const db = createAdminClient();
  const { data: claimed, error } = await db
    .from("ai_jobs")
    .update({ metadata: { ...(row.metadata ?? {}), included_use: { ...used, released: true, released_at: new Date().toISOString(), released_reason: reason } } })
    .eq("id", jobId)
    .is("metadata->included_use->>released", null)
    .select("id")
    .maybeSingle();
  if (error || !claimed) return false;
  const { error: rpcError } = await db.rpc("release_feature_included", { p_user_id: row.user_id, p_feature: used.feature, p_period_key: used.periodKey });
  if (rpcError) {
    console.error("[ai/included] release failed", { jobId, message: rpcError.message });
    return false;
  }
  await recordJobEvent(jobId, "refund.issued", { reason, includedUse: used.feature, periodKey: used.periodKey, from: "included" }).catch(() => null);
  return true;
}

/** Whether a job was funded by an included generation (read from the row's metadata). */
export function jobUsedIncluded(metadata: unknown): boolean {
  return !!(metadata as { included_use?: IncludedUse } | null)?.included_use;
}
