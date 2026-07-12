import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Part 8 "Notification Fatigue Reduction" — a real, honest frequency cap,
 * not a learned model. Reuses Part 7's `push_delivery_log` (already logs
 * every push attempt) rather than standing up separate tracking — one
 * indexed COUNT query, same "no separate metrics pipeline" reasoning as
 * messaging-stats.ts / push-delivery-stats.ts.
 *
 * Deliberately generous (30/hour) and deliberately only checked for
 * `medium`/`low` priority (mirrored at the call site in smart-delivery.ts,
 * matching the existing DND-hold-back carve-out) — this is a safety net
 * against a genuine flood, not a tight limiter that could silently eat a
 * push a user actually wanted. A push held back here still lands in-app via
 * Realtime + the Notification Center, same as the DND case.
 *
 * Multi-device caveat: `push_delivery_log` has one row per delivery
 * ATTEMPT, so a user with 3 signed-in devices generates 3 rows per logical
 * notification — the cap is generous specifically to absorb this without
 * false-triggering for a normal multi-device user.
 */
const FREQUENCY_CAP_PER_HOUR = 30;

/** Pure — the actual threshold decision, unit-tested without a DB. */
export function shouldThrottleFrequency(recentPushCount: number, cap: number = FREQUENCY_CAP_PER_HOUR): boolean {
  return recentPushCount >= cap;
}

export async function isOverPushFrequencyCap(userId: string): Promise<boolean> {
  try {
    const db = createAdminClient();
    const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    const { count } = await db
      .from("push_delivery_log")
      .select("id", { head: true, count: "exact" })
      .eq("user_id", userId)
      .in("status", ["sent", "retried"])
      .gte("created_at", oneHourAgo);
    return shouldThrottleFrequency(count ?? 0);
  } catch {
    // Fail OPEN — a broken frequency check must never be the reason a real
    // push silently never arrives (exactly the failure class fixed last round).
    return false;
  }
}
