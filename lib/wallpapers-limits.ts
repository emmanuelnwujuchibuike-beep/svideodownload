import type { BillingPlan } from "@/lib/monetization/types";

/**
 * How many wallpapers a plan may download per day, and what it costs to do it.
 *
 * ── Why a wallpaper cap exists at all (owner, 2026-08-09) ─────────────────────
 * "Free users can only download 5 wallpapers a day, so reward ad won't be
 * spamming and break AdSense reward ad policy."
 *
 * That reasoning is the important part, and it is the right way round: the limit
 * is not there to make the product worse, it is there because every free
 * download shows a 30-second rewarded ad, and an unbounded stream of rewarded
 * ads to one person in one session is exactly the pattern ad networks treat as
 * inventory abuse. Five is a real number of wallpapers for a real person and a
 * defensible number of rewarded impressions.
 *
 * Paying members see no ad and have no wallpaper cap — they have already paid
 * for the thing the ad exists to fund.
 *
 * ── Where it is enforced ──────────────────────────────────────────────────────
 * On the SERVER, in `/api/wallpaper?dl=1`, which is the single endpoint every
 * wallpaper download goes through (built-ins and uploads alike). The countdown
 * in the UI is a courtesy, not a gate: a client-side limit is a suggestion, and
 * the ad it is protecting is worth real money.
 */

/** Free plan: five wallpapers per UTC day. 0 means "no cap". */
export const WALLPAPER_DAILY_LIMITS: Record<BillingPlan, number> = {
  free: 5,
  pro: 0,
  business: 0,
};

/** Seconds of rewarded ad before a free download starts. */
export const WALLPAPER_REWARD_SECONDS = 30;

export function wallpaperDailyLimit(plan: BillingPlan): number {
  return WALLPAPER_DAILY_LIMITS[plan] ?? WALLPAPER_DAILY_LIMITS.free;
}

/** Does this plan watch an ad to download a wallpaper? */
export function wallpaperNeedsReward(plan: BillingPlan): boolean {
  return wallpaperDailyLimit(plan) > 0;
}

/**
 * What to tell someone who has used their allowance.
 *
 * Written as a sentence rather than a code, because this is the message a real
 * person reads at the exact moment the product says no — it should say what
 * happened, when it changes, and what the alternative is, in that order.
 */
export function wallpaperLimitMessage(limit: number): string {
  return `That's your ${limit} free wallpapers for today. The count resets at midnight UTC — or go Pro for unlimited downloads with no ads.`;
}
