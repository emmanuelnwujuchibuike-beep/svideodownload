import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Global monetization switches, stored in the `settings` table under key
 * `monetization` so an admin can flip whole subsystems on/off from the
 * dashboard without a redeploy. Mirrors the pricing / plan-limits pattern.
 *
 * Defaults: everything ON (the historical behaviour), so an unconfigured site
 * behaves exactly as before.
 */

export interface MonetizationSettings {
  /** Google AdSense units (banners, and the video placements). */
  adsense: boolean;
  /** Adsterra networks. */
  adsterra: boolean;
  /** PropellerAds networks. */
  propellerads: boolean;
  /** Affiliate offers on the download-result page. */
  affiliates: boolean;
  /** Curated "Recommended Tools" sections (homepage/footer/sidebar/blog). */
  recommendedTools: boolean;
  /**
   * Allow interstitial / full-page units — the idle and download-complete
   * placements, and any `video` unit.
   *
   * Defaults OFF. These are the most intrusive placements on the site and
   * turning them on should be a deliberate act, not something inherited by a
   * site that never configured anything.
   */
  interstitial: boolean;
}

/*
  `popunder` is deliberately absent. It was a switch that defaulted to ON and
  permitted click-hijacking units; the format itself is now retired in
  `ad-schema.ts`, which is a stronger guarantee than a toggle. A stored value
  from before this change is simply ignored by the merge below.
*/
export const DEFAULT_MONETIZATION: MonetizationSettings = {
  adsense: true,
  adsterra: true,
  propellerads: true,
  affiliates: true,
  recommendedTools: true,
  interstitial: false,
};

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

let cache: { at: number; value: MonetizationSettings } | null = null;
const TTL_MS = 60_000;

/** Effective global monetization settings (defaults + admin overrides). */
export async function getMonetizationSettings(): Promise<MonetizationSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  if (!hasSupabase) return DEFAULT_MONETIZATION;
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("settings")
      .select("value")
      .eq("key", "monetization")
      .maybeSingle();
    const merged: MonetizationSettings = {
      ...DEFAULT_MONETIZATION,
      ...((data?.value ?? {}) as Partial<MonetizationSettings>),
    };
    cache = { at: Date.now(), value: merged };
    return merged;
  } catch {
    return DEFAULT_MONETIZATION;
  }
}

/** Admin: persist the global monetization switches. */
export async function setMonetizationSettings(s: MonetizationSettings): Promise<void> {
  const db = createAdminClient();
  await db.from("settings").upsert({ key: "monetization", value: s }, { onConflict: "key" });
  cache = null;
}
