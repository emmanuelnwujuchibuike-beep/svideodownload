import { selectAffiliateOffer } from "./affiliates";
import { getMonetizationSettings } from "./settings";
import type { AdZone, RequestContext, RevenueStrategy } from "./types";

/**
 * Core monetization decision engine.
 *
 *   IF premium            → no ads/offers (clean experience)
 *   ELSE IF affiliate fit → show the affiliate CTA (highest eCPM when relevant)
 *   ELSE IF high value    → show ads
 *   ELSE IF developer     → API upsell
 *   ELSE                  → default ads
 *
 * Tunable via env:
 *   MONETIZATION_AFFILIATE_RATE  (0–1) how often to prefer an affiliate offer
 *   MONETIZATION_VALUE_THRESHOLD (0–1) min traffic value to fill premium ads
 */
const AFFILIATE_RATE = clamp01(Number(process.env.MONETIZATION_AFFILIATE_RATE ?? 0.4));
const VALUE_THRESHOLD = clamp01(Number(process.env.MONETIZATION_VALUE_THRESHOLD ?? 0.55));

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

export function isPremium(ctx: RequestContext): boolean {
  return ctx.plan === "pro" || ctx.plan === "business";
}

/**
 * Decide what to surface on the download/result step for this visit. The `zone`
 * controls which ad slot fills when the strategy is "ad".
 */
export async function selectRevenueStrategy(
  ctx: RequestContext,
  zone: AdZone = "download_result_page",
): Promise<RevenueStrategy> {
  // 1) Premium users get a clean, ad-free experience.
  if (isPremium(ctx)) return { type: "none" };

  // Respect the admin's global toggles.
  const settings = await getMonetizationSettings();
  const adsOn = settings.adsterra || settings.propellerads;

  // 2) Try an affiliate offer (rate-limited so we still mix in upgrade prompts).
  if (settings.affiliates && Math.random() < AFFILIATE_RATE) {
    const offer = await selectAffiliateOffer(ctx);
    if (offer) return { type: "affiliate", offer };
  }

  // 3) High-value traffic → ads (best RPM fill).
  if (adsOn && ctx.value >= VALUE_THRESHOLD) return { type: "ad", zone };

  // 4) Developer-looking visit with no fill → API upsell.
  if (ctx.isDeveloper) return { type: "api_upsell" };

  // 5) Nudge free users toward Pro instead of another ad (always, if ads off).
  if (!adsOn || Math.random() < 0.15) {
    return { type: "premium_prompt", reason: "remove_ads" };
  }

  // 6) Default: ads.
  return { type: "ad", zone };
}
