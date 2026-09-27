import "server-only";

import { recordJobEvent } from "@/lib/ai/job-events";
import { getJobAsService } from "@/lib/ai/job-store";
import { readTextToAudioMeta } from "@/lib/ai/text-to-audio/job-meta";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE MONTHLY FREE CHARACTERS (migration 0170: ai_tta_free_usage)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner: "the text to audio should have a free of 500 characters a month to
 * free and all sub users." One counter per member per calendar month in the
 * operator's zone; two SQL functions are its only writers, each atomic under
 * a per-member advisory lock:
 *
 *   consume_tta_free_characters(user, month, characters, allowance)
 *       takes up to `characters` of what is left → { covered, used, allowance }
 *   release_tta_free_characters(user, month, characters)
 *       gives `characters` back (a failed generation) → the new `used`
 *
 * The release is guarded ONCE per job here: the row's
 * `free_characters.released` flag is claimed with a conditional update before
 * the function runs, so the webhook's failure path, the stall sweep and the
 * finalizer's give-up cannot each hand the same characters back.
 */
export interface FreeCharactersState {
  allowance: number;
  used: number;
  remaining: number;
  monthKey: string;
}

export async function readFreeCharacters(userId: string, monthKey: string, allowance: number): Promise<FreeCharactersState> {
  if (allowance <= 0) return { allowance: 0, used: 0, remaining: 0, monthKey };
  const { data, error } = await createAdminClient().from("ai_tta_free_usage").select("used").eq("user_id", userId).eq("month_key", monthKey).maybeSingle();
  if (error) {
    // the table missing (0170 not applied yet) reads as "no allowance" — a member is never told they have characters the server cannot take
    console.error("[tta/free] read failed", { userId, monthKey, message: error.message });
    return { allowance: 0, used: 0, remaining: 0, monthKey };
  }
  const used = Math.max(0, Number((data as { used?: unknown } | null)?.used ?? 0) || 0);
  return { allowance, used, remaining: Math.max(0, allowance - used), monthKey };
}

export async function consumeFreeCharacters(userId: string, monthKey: string, characters: number, allowance: number): Promise<{ covered: number; used: number } | null> {
  if (allowance <= 0 || characters <= 0) return { covered: 0, used: 0 };
  const { data, error } = await createAdminClient().rpc("consume_tta_free_characters", { p_user_id: userId, p_month_key: monthKey, p_characters: characters, p_allowance: allowance });
  if (error) {
    console.error("[tta/free] consume failed", { userId, monthKey, message: error.message });
    return null;
  }
  const d = (data ?? {}) as { covered?: unknown; used?: unknown };
  return { covered: Math.max(0, Number(d.covered ?? 0) || 0), used: Math.max(0, Number(d.used ?? 0) || 0) };
}

/**
 * Give a failed generation's free characters back — once. Reads the row,
 * claims the `released` mark with a compare-and-set on the metadata, then
 * calls the function. Safe from every undo path.
 */
export async function releaseFreeCharactersForJob(jobId: string, reason: string): Promise<number> {
  const row = await getJobAsService(jobId);
  if (!row || !row.user_id) return 0;
  const meta = readTextToAudioMeta(row.metadata);
  const free = meta?.free_characters ?? null;
  if (!free || free.covered <= 0 || free.released) return 0;
  const db = createAdminClient();
  const { data: claimed, error } = await db
    .from("ai_jobs")
    .update({ metadata: { ...(row.metadata ?? {}), free_characters: { ...free, released: true, released_at: new Date().toISOString(), released_reason: reason } } })
    .eq("id", jobId)
    .is("metadata->free_characters->>released", null)
    .select("id")
    .maybeSingle();
  if (error || !claimed) return 0;
  const { data, error: rpcError } = await db.rpc("release_tta_free_characters", { p_user_id: row.user_id, p_month_key: free.monthKey, p_characters: free.covered });
  if (rpcError) {
    console.error("[tta/free] release failed", { jobId, message: rpcError.message });
    return 0;
  }
  await recordJobEvent(jobId, "refund.issued", { reason, freeCharacters: free.covered, monthKey: free.monthKey, from: "tta-free" }).catch(() => null);
  void data;
  return free.covered;
}
