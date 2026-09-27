import "server-only";

import { recordJobEvent } from "@/lib/ai/job-events";
import { getJobAsService } from "@/lib/ai/job-store";
import { readVoiceCloneMeta } from "@/lib/ai/voice-clone/job-meta";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE MONTHLY FREE VOICE (migration 0171: ai_vc_free_usage)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The Text to Audio pattern (lib/ai/text-to-audio/free.ts), counting VOICES.
 * One counter per member per calendar month in the operator's zone; two SQL
 * functions are its only writers, each atomic under a per-member advisory
 * lock:
 *
 *   consume_vc_free_clones(user, month, clones, allowance)
 *       takes up to `clones` of what is left → { covered, used, allowance }
 *   release_vc_free_clones(user, month, clones)
 *       gives them back (a clone the provider refused) → the new `used`
 *
 * ── 🔴 THE RELEASE IS GUARDED ONCE PER JOB ──────────────────────────────────
 * The row's `free_clones.released` flag is claimed with a CONDITIONAL UPDATE
 * before the function runs. Without that, the provider-refusal path, the
 * generic funding undo and an operator's manual refund could each hand the
 * same free voice back, and a member would quietly collect allowance they
 * never spent. This is the same guard, for the same reason, as the characters.
 */
export interface FreeClonesState {
  allowance: number;
  used: number;
  remaining: number;
  monthKey: string;
}

export async function readFreeClones(userId: string, monthKey: string, allowance: number): Promise<FreeClonesState> {
  if (allowance <= 0) return { allowance: 0, used: 0, remaining: 0, monthKey };
  const { data, error } = await createAdminClient().from("ai_vc_free_usage").select("used").eq("user_id", userId).eq("month_key", monthKey).maybeSingle();
  if (error) {
    // the table missing (0171 not applied yet) reads as "no allowance" — a member is never offered something the server cannot take
    console.error("[vc/free] read failed", { userId, monthKey, message: error.message });
    return { allowance: 0, used: 0, remaining: 0, monthKey };
  }
  const used = Math.max(0, Number((data as { used?: unknown } | null)?.used ?? 0) || 0);
  return { allowance, used, remaining: Math.max(0, allowance - used), monthKey };
}

export async function consumeFreeClone(userId: string, monthKey: string, allowance: number): Promise<{ covered: number; used: number } | null> {
  if (allowance <= 0) return { covered: 0, used: 0 };
  const { data, error } = await createAdminClient().rpc("consume_vc_free_clones", { p_user_id: userId, p_month_key: monthKey, p_clones: 1, p_allowance: allowance });
  if (error) {
    console.error("[vc/free] consume failed", { userId, monthKey, message: error.message });
    return null;
  }
  const d = (data ?? {}) as { covered?: unknown; used?: unknown };
  return { covered: Math.max(0, Number(d.covered ?? 0) || 0), used: Math.max(0, Number(d.used ?? 0) || 0) };
}

/** Hand one back directly — used by the start path, which holds no row yet to mark. */
export async function releaseFreeClone(userId: string, monthKey: string, why: string): Promise<void> {
  const { error } = await createAdminClient().rpc("release_vc_free_clones", { p_user_id: userId, p_month_key: monthKey, p_clones: 1 });
  if (error) console.error("[vc/free] release failed", { userId, monthKey, why, message: error.message });
}

/**
 * Give a failed clone's free voice back — ONCE. Reads the row, claims the
 * `released` mark with a compare-and-set on the metadata, then calls the
 * function. Safe from every undo path.
 */
export async function releaseFreeCloneForJob(jobId: string, reason: string): Promise<boolean> {
  const row = await getJobAsService(jobId);
  if (!row || !row.user_id) return false;
  const meta = readVoiceCloneMeta(row.metadata);
  const free = meta?.free_clones ?? null;
  if (!free || free.covered <= 0 || free.released) return false;
  const db = createAdminClient();
  const { data: claimed, error } = await db
    .from("ai_jobs")
    .update({ metadata: { ...(row.metadata ?? {}), free_clones: { ...free, released: true, released_at: new Date().toISOString(), released_reason: reason } } })
    .eq("id", jobId)
    .is("metadata->free_clones->>released", null)
    .select("id")
    .maybeSingle();
  if (error || !claimed) return false;
  const { error: rpcError } = await db.rpc("release_vc_free_clones", { p_user_id: row.user_id, p_month_key: free.monthKey, p_clones: free.covered });
  if (rpcError) {
    console.error("[vc/free] release failed", { jobId, message: rpcError.message });
    return false;
  }
  await recordJobEvent(jobId, "refund.issued", { reason, freeClones: free.covered, monthKey: free.monthKey, from: "vc-free" }).catch(() => null);
  return true;
}
