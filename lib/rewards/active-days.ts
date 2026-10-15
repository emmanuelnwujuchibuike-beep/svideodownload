import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The member's ACTIVE days — the days they actually showed up — for the withdrawal rule
 * (owner, 2026-10-15: "account age for withdrawal requirements should be counted with the
 * days active, not the days the account was created").
 *
 * Source: `streaks.total_active_days`, the count behind the daily streak. It rises by one per
 * calendar day the member was active, and Postgres makes that idempotent (the
 * streak_daily_activity primary key — see 0130_streaks.sql). The account's creation date no
 * longer comes into it. No streak row yet (never active since streaks began) or an unreadable
 * read is 0: never a guess from the creation date.
 */
export async function loadActiveDays(userId: string): Promise<number> {
  const { data, error } = await createAdminClient().from("streaks").select("total_active_days").eq("user_id", userId).maybeSingle();
  if (error) {
    console.error("[rewards/active-days] read failed", { userId, message: error.message });
    return 0;
  }
  const n = Number((data as { total_active_days?: number } | null)?.total_active_days ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
