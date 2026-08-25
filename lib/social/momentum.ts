import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Momentum Engine™ (Feature 15 Part 8) — admin-tunable weights for
 * `recompute_momentum_scores` (migration 0133), mirroring `getTrendingSettings`
 * in lib/social/feed.ts exactly (same `settings` table, same cache shape). A
 * SEPARATE score from hot_score on purpose: hot_score rewards lifetime
 * engagement discounted by age (right for "Trending"), momentum_score rewards
 * a post that is young AND already earning engagement AND genuinely being
 * watched, not just glanced at (right for surfacing creators before they're
 * already popular — see the Creator Fairness note in
 * docs/FEATURE_15_PART_8_DISCOVERY.md).
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface MomentumSettings {
  wCompletion: number;
  wVelocity: number;
  wRepost: number;
  gravity: number;
  maxAgeHours: number;
}

export const DEFAULT_MOMENTUM: MomentumSettings = {
  wCompletion: 1,
  wVelocity: 1,
  wRepost: 2,
  gravity: 1.2,
  maxAgeHours: 336, // 14 days — momentum is about RECENT rise, not lifetime standing
};

let momentumCache: { at: number; value: MomentumSettings } | null = null;

export async function getMomentumSettings(): Promise<MomentumSettings> {
  if (momentumCache && Date.now() - momentumCache.at < 60_000) return momentumCache.value;
  if (!hasSupabase) return DEFAULT_MOMENTUM;
  try {
    const { data } = await createAdminClient()
      .from("settings")
      .select("value")
      .eq("key", "momentum")
      .maybeSingle();
    const merged = { ...DEFAULT_MOMENTUM, ...((data?.value ?? {}) as Partial<MomentumSettings>) };
    momentumCache = { at: Date.now(), value: merged };
    return merged;
  } catch {
    return DEFAULT_MOMENTUM;
  }
}

export async function setMomentumSettings(s: MomentumSettings): Promise<void> {
  await createAdminClient().from("settings").upsert({ key: "momentum", value: s }, { onConflict: "key" });
  momentumCache = null;
}

/** Recompute momentum_score + completion_rate for recently-active posts. */
export async function recomputeMomentumScores(): Promise<number> {
  if (!hasSupabase) return 0;
  const s = await getMomentumSettings();
  const { data } = await createAdminClient().rpc("recompute_momentum_scores", {
    w_completion: s.wCompletion,
    w_velocity: s.wVelocity,
    w_repost: s.wRepost,
    gravity: s.gravity,
    max_age_hours: s.maxAgeHours,
  });
  return (data as number) ?? 0;
}
