import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A site-wide "free Pro" promo — owner, 2026-08-16: "Set up a promo system
 * where admin can activate a 1week or 1month or 2 weeks, depends on the
 * promo, free pro plan for users in a certain period and can turn it off at
 * anytime."
 *
 * Stored as one row in the `settings` table (key `pro_promo`), same pattern
 * as `lib/monetization/settings.ts` and `plan.ts`'s `plan_limits` — so an
 * admin can flip it without a redeploy.
 *
 * ── Why "ends at a timestamp" rather than "a duration that ticks down" ─────
 * Storing the ABSOLUTE end time (computed once, when the admin picks a
 * duration) means every reader — this module, any serverless instance,
 * any cron that might run later — agrees on when the promo ends without
 * needing to know when it started or do date arithmetic themselves. It also
 * means the promo naturally expires on its own the moment `Date.now()`
 * passes `endsAt`, with no cron required to flip a flag.
 *
 * ── "Turn it off at anytime" ────────────────────────────────────────────
 * `active: false` overrides everything else regardless of `endsAt` — an
 * admin ending a promo early doesn't need to also clear the timestamp.
 */
export interface PromoSettings {
  active: boolean;
  /** ms epoch this run was activated, or null if never activated. */
  startedAt: number | null;
  /** ms epoch this run auto-ends. Null means "no ask for a duration was
   *  ever made" — treated as inactive, never as "forever", so a promo can
   *  never be considered running without a real end date set alongside it. */
  endsAt: number | null;
}

export const DEFAULT_PROMO: PromoSettings = { active: false, startedAt: null, endsAt: null };

/** Durations the admin can pick, in days. */
export const PROMO_DURATIONS = { "1week": 7, "2weeks": 14, "1month": 30 } as const;
export type PromoDuration = keyof typeof PROMO_DURATIONS;

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

// Short TTL, like monetization settings — this gates a real entitlement
// (free Pro), so an admin turning it off should take effect within seconds,
// not minutes.
const TTL_MS = 10_000;
let cache: { at: number; value: PromoSettings } | null = null;

export async function getPromoSettings(): Promise<PromoSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  if (!hasSupabase) return DEFAULT_PROMO;
  try {
    const db = createAdminClient();
    const { data, error } = await db
      .from("settings")
      .select("value")
      .eq("key", "pro_promo")
      .maybeSingle();
    if (error) return DEFAULT_PROMO;
    const merged: PromoSettings = { ...DEFAULT_PROMO, ...((data?.value ?? {}) as Partial<PromoSettings>) };
    cache = { at: Date.now(), value: merged };
    return merged;
  } catch {
    return DEFAULT_PROMO;
  }
}

/** Admin: persist the promo state. */
export async function setPromoSettings(s: PromoSettings): Promise<void> {
  const db = createAdminClient();
  await db.from("settings").upsert({ key: "pro_promo", value: s }, { onConflict: "key" });
  cache = null;
}

/**
 * True right now — `active` AND (no end date has passed yet). This is the
 * one function `getUserPlan` (lib/monetization/plan.ts) actually calls;
 * everything above is bookkeeping for the admin panel and this check.
 */
export async function isPromoActiveNow(): Promise<boolean> {
  const s = await getPromoSettings();
  if (!s.active) return false;
  if (s.endsAt !== null && Date.now() >= s.endsAt) return false;
  return true;
}
