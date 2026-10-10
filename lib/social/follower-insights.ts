import "server-only";

import { FOLLOW_SOURCES, followerFlow, sourceBreakdown, type FollowerDay, type FollowSource } from "@/lib/social/follow-policy";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Audience Intelligence™ — follower flow and follow sources (Feature 19 · Part 3).
 *
 * Counts only, never who: follower_daily (0217) holds gained/lost per day, kept
 * by a trigger; sources are counted over the account's current followers and
 * folded away below MIN_SOURCE_COHORT (lib/social/follow-policy.ts).
 *
 * `available: false` until 0217 has run. Days before it ran have no row, so the
 * flow honestly starts counting from then — nothing is backfilled or estimated.
 */
export interface FollowerInsights {
  available: boolean;
  week: { gained: number; lost: number; net: number };
  month: { gained: number; lost: number; net: number };
  sources: { source: FollowSource; count: number; share: number }[];
}

const EMPTY: FollowerInsights = { available: false, week: { gained: 0, lost: 0, net: 0 }, month: { gained: 0, lost: 0, net: 0 }, sources: [] };

export async function followerInsights(userId: string, now: number = Date.now()): Promise<FollowerInsights> {
  try {
    const db = createAdminClient();
    const today = new Date(now).toISOString().slice(0, 10);
    const since = new Date(now - 29 * 86_400_000).toISOString().slice(0, 10);
    const { data, error } = await db.from("follower_daily").select("day, gained, lost").eq("user_id", userId).gte("day", since);
    if (error) return EMPTY;
    const rows = (data as FollowerDay[]) ?? [];
    const counts = await Promise.all(
      FOLLOW_SOURCES.map(async (s) => {
        const { count } = await db.from("follows").select("follower_id", { head: true, count: "exact" }).eq("following_id", userId).eq("source", s);
        return [s, count ?? 0] as const;
      }),
    );
    return {
      available: true,
      week: followerFlow(rows, 7, today),
      month: followerFlow(rows, 30, today),
      sources: sourceBreakdown(Object.fromEntries(counts)),
    };
  } catch {
    return EMPTY;
  }
}
