import "server-only";

import { AI_PLAN_IDS, type AiPlanId, type AiPlansConfig } from "@/lib/ai/credits/config";
import { readFlutterwavePlan } from "@/lib/flutterwave/client";
import { flutterwaveUsableFor, getFlutterwaveConfig } from "@/lib/flutterwave/config";
import { getPricing } from "@/lib/monetization/pricing";
import { FLUTTERWAVE_LOCAL_CURRENCY, flutterwaveChargeFor } from "@/lib/payments/flutterwave-charge";
import { aiPlanShownUsdCents, displayPriceUsdCents, flutterwavePlanCompat } from "@/lib/payments/plan-compat";

/**
 * The two plan buttons a member in NIGERIA sees (owner, 2026-10-24: "Two buttons at checkout" — for the AI plans and
 * Pro / Business), each with the exact amount it will charge, so the price is on the button before checkout:
 *
 *   renew — "Card — renews monthly": a Flutterwave subscription, on the NAIRA plan when one is configured (its own fixed
 *           amount), else the USD plan at the shown USD price.
 *   once  — "Bank transfer / USSD — 1 month": the shown USD price in naira at today's live rate (lib/payments/flutterwave-charge.ts).
 *
 * Display only — the checkout routes re-decide everything from scratch (the amount is never taken from the browser).
 * null for a button that cannot be offered right now. Flutterwave plan amounts are cached for 10 minutes.
 */
export type NgPlanId = AiPlanId | "pro" | "business";
export interface NgPlanPrice {
  currency: string;
  amountMinor: number;
}
/** quarter (Pro / Business only, 2026-10-24): the 3-month bundle in naira — Admin → Pricing's price at today's rate */
export type NgPlanBilling = Record<NgPlanId, { renew: NgPlanPrice | null; once: NgPlanPrice | null; quarter?: NgPlanPrice | null }>;

const PLAN_TTL_MS = 10 * 60_000;
const planCache = new Map<string, { at: number; price: NgPlanPrice | null }>();

/** A naira payment plan's own price, when it can be sold (active, NGN, monthly, a fixed amount); cached. */
async function ngnPlanPrice(id: string, interval: "monthly" | "yearly"): Promise<NgPlanPrice | null> {
  if (!id) return null;
  const hit = planCache.get(id);
  if (hit && Date.now() - hit.at < PLAN_TTL_MS) return hit.price;
  let price: NgPlanPrice | null = null;
  try {
    const facts = await readFlutterwavePlan(id);
    if (flutterwavePlanCompat(facts, { amountMinor: facts.amountMinor ?? null, interval }, FLUTTERWAVE_LOCAL_CURRENCY).ok && facts.amountMinor) price = { currency: FLUTTERWAVE_LOCAL_CURRENCY, amountMinor: facts.amountMinor };
  } catch {
    price = null;
  }
  planCache.set(id, { at: Date.now(), price });
  return price;
}

export async function ngPlanBilling(plans: AiPlansConfig, listCurrency: string): Promise<NgPlanBilling> {
  const cfg = await getFlutterwaveConfig();
  const aiOk = flutterwaveUsableFor("ai_subscription", cfg);
  const siteOk = flutterwaveUsableFor("site_subscription", cfg);
  const pricing = siteOk ? await getPricing() : null;

  const entry = async (purpose: "ai_subscription" | "site_subscription", usable: boolean, usdPlanId: string, ngnPlanId: string, shownUsd: number | null, interval: "monthly" | "yearly") => {
    if (!usable || !usdPlanId || !shownUsd) return { renew: null, once: null };
    const once = await flutterwaveChargeFor(shownUsd, "NG", purpose);
    return {
      renew: (await ngnPlanPrice(ngnPlanId, interval)) ?? { currency: "USD", amountMinor: shownUsd },
      once: once.currency === FLUTTERWAVE_LOCAL_CURRENCY ? { currency: once.currency, amountMinor: once.amountMinor } : null,
    };
  };

  const out = {} as NgPlanBilling;
  for (const id of AI_PLAN_IDS) {
    const p = plans.plans[id];
    out[id] = await entry("ai_subscription", aiOk && p.enabled, p.flutterwavePlanId, p.flutterwavePlanIdNgn, aiPlanShownUsdCents(p.priceCents, listCurrency), p.interval);
  }
  const quarter = async (usd: number | null): Promise<NgPlanPrice | null> => {
    if (!siteOk || !usd) return null;
    const c = await flutterwaveChargeFor(usd, "NG", "site_subscription");
    return c.currency === FLUTTERWAVE_LOCAL_CURRENCY ? { currency: c.currency, amountMinor: c.amountMinor } : null;
  };
  out.pro = { ...(await entry("site_subscription", siteOk, cfg.sitePlanPro, cfg.sitePlanProNgn, pricing ? displayPriceUsdCents(pricing.pro.price) : null, "monthly")), quarter: await quarter(pricing ? displayPriceUsdCents(pricing.ngQuarterly?.pro ?? "") : null) };
  out.business = { ...(await entry("site_subscription", siteOk, cfg.sitePlanBusiness, cfg.sitePlanBusinessNgn, pricing ? displayPriceUsdCents(pricing.business.price) : null, "monthly")), quarter: await quarter(pricing ? displayPriceUsdCents(pricing.ngQuarterly?.business ?? "") : null) };
  return out;
}
