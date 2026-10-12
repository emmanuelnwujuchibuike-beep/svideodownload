import type { BillingPlan } from "@/lib/monetization/types";

/**
 * WHICH ADS A PLAN SEES — the one rule (owner 2026-10-12):
 *
 *   free      every ad
 *   pro       ONLY the download-result ad, the History ads, the Feed ad and the Reels ad
 *   business  no ad at all
 *
 * A placement is named by its ad zone, slot id or History tag (the names the ad
 * components already use). An ad component that names no placement is "every other
 * ad" — so Pro loses it, and a new ad stays off for Pro until it is added here.
 * Pure and tested (plan-ads.test.ts).
 */
export const PRO_AD_PLACEMENTS: readonly string[] = [
  // the download result (the result page box and the finished-download moment)
  "download_result_page",
  "download_complete",
  // History
  "download_history_top",
  "download_history_bottom",
  "history_grid",
  "history",
  "historyfeed",
  "historyfallback",
  "historyfeedlastweek",
  // Feed and Reels
  "feed_inline",
  "reels_interstitial",
];
// the list above, as one pattern — what ships in the browser (the list is for tests and readers; plan-ads.test pins they agree)
const PRO = /^(download_(result_page|complete|history_top|history_bottom)|history(_grid|feed|fallback|feedlastweek)?|feed_inline|reels_interstitial)$/;

export function planSeesAd(plan: BillingPlan, placement?: string | null): boolean {
  if (plan === "free") return true;
  if (plan === "business") return false;
  return !!placement && PRO.test(placement);
}
