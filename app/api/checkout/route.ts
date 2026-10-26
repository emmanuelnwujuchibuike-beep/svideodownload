import { NextResponse } from "next/server";
import { z } from "zod";

import { markPlanCheckout, recordPlanAttempt, resolvePlanCheckout } from "@/lib/ai/credits/plan-attempts";
import { createFlutterwaveCheckout, flutterwaveFailureIsDefinite, readFlutterwavePlan } from "@/lib/flutterwave/client";
import { FLUTTERWAVE_CHECKOUT_CURRENCY, flutterwaveUsableFor, getFlutterwaveConfig } from "@/lib/flutterwave/config";
import { getLandingSettings } from "@/lib/landing/settings";
import { getUserPlan, planRank } from "@/lib/monetization/plan";
import { getPricing } from "@/lib/monetization/pricing";
import { openOneOffPlanCheckout } from "@/lib/ai/credits/plan-oneoff";
import type { PaymentMarket } from "@/lib/ai/credits/wallet-config";
import { displayPriceUsdCents, flutterwavePlanCompat } from "@/lib/payments/plan-compat";
import { newFlutterwaveReference } from "@/lib/payments/references";
import { firstRail, paymentCountry, paymentMarket, routePayment, type RailAttempt } from "@/lib/payments/router";
import { initializeTransaction, paystackEnabled, paystackRefusedForSure, planCodeForPlan } from "@/lib/paystack/paystack";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// `provider` is only a preference among the rails offered (Flutterwave first, Paystack the backup) — how a member paying by
// bank transfer or USSD (which Flutterwave payment plans can't take) reaches Paystack
// billing (2026-10-24): the button a member in Nigeria pressed — "renew" (card, monthly subscription) or "once" (one naira month). Never a price.
const schema = z.object({ plan: z.enum(["pro", "business"]), provider: z.string().max(20).optional(), billing: z.enum(["renew", "once", "quarter"]).optional() });

/**
 * Starts a Pro / Business subscription checkout for the signed-in user.
 *
 * ── WHICH RAIL (owner, 2026-10-23: "Pro and business should be Flutterwave too") ──
 * Flutterwave first: a USD payment plan, CARD only — usable when its capability gate allows site plans AND the plan
 * carries a Flutterwave plan id (Admin → Flutterwave). The attempt is written BEFORE Flutterwave is called, so the
 * webhook and the 10-minute cron settle it exactly once (lib/ai/credits/plan-attempts.ts). Paystack (NGN) is the backup,
 * unchanged: its own subscription lifecycle (lib/paystack/sync.ts). An unknown Flutterwave outcome is held, never sent on.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in first.", login: true }, { status: 401 });
  }
  if (!user.email) {
    return NextResponse.json({ error: "Your account needs an email to subscribe." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose a valid plan." }, { status: 400 });
  }
  const planId = parsed.data.plan;

  // Part 3.3: an UPGRADE (Pro → Business) stays on the rail that bills the current plan — the other provider can't cancel it
  const { data: currentRow } = await createAdminClient().from("subscriptions").select("provider, status").eq("user_id", user.id).maybeSingle();
  const current = currentRow as { provider?: string | null; status?: string | null } | null;
  const sameRail = current && (current.status === "active" || current.status === "trialing") && (current.provider === "paystack" || current.provider === "flutterwave") ? current.provider : null;
  const fw = await getFlutterwaveConfig();
  const fwPlanId = planId === "pro" ? fw.sitePlanPro : fw.sitePlanBusiness;
  // the naira card plan for Nigeria (2026-10-24); "" = card renewals use the USD plan
  const fwPlanIdNgn = planId === "pro" ? fw.sitePlanProNgn : fw.sitePlanBusinessNgn;
  const flutterwaveOk = sameRail !== "paystack" && flutterwaveUsableFor("site_subscription", fw) && !!fwPlanId;
  const paystackPlanCode = sameRail !== "flutterwave" && (await paystackEnabled()) ? await planCodeForPlan(planId) : null;
  const settings = await getLandingSettings();
  const wallet = settings.frenzAiPlans.wallet;
  const routed = routePayment({ purpose: "site_subscription", market: paymentMarket(request.headers), routing: wallet.routing, usable: (p) => (p === "flutterwave" ? flutterwaveOk : p === "paystack" && !!paystackPlanCode), preferred: wallet.memberChoice ? parsed.data.provider : undefined });
  // the 3-month bundle (Nigeria) exists only on Flutterwave — never fall back to a Paystack monthly plan, another product at another price
  const candidates = parsed.data.billing === "quarter" ? routed.filter((p) => p === "flutterwave") : routed;
  if (!candidates.length) {
    return NextResponse.json({ error: "Billing isn't available yet." }, { status: 503 });
  }

  // a member already on this plan or a higher one has nothing to buy here
  if (planRank(await getUserPlan(user.id)) >= planRank(planId)) {
    return NextResponse.json({ error: "You're already on this plan.", alreadyOn: planId }, { status: 409 });
  }
  // one intent, one checkout: an open Flutterwave attempt is handed back; one that might be paid holds a second
  const open = await resolvePlanCheckout(user.id, planId, settings.frenzAiPlans);
  if (open.kind === "reuse") return NextResponse.json({ url: open.url, reused: true });
  if (open.kind === "activated") return NextResponse.json({ error: "You're already on this plan.", alreadyOn: planId }, { status: 409 });
  if (open.kind === "held") return NextResponse.json({ error: "Your last payment is still being confirmed. Try again in a few minutes.", code: "PAYMENT_CONFIRMING" }, { status: 409 });

  const base = SITE_URL || new URL(request.url).origin;
  // Part 6: the price members are SHOWN on /pricing — a Flutterwave plan is used only at exactly this amount
  const pricingNow = flutterwaveOk ? await getPricing() : null;
  const shownCents = pricingNow ? displayPriceUsdCents(pricingNow[planId].price) : null;
  const quarterCents = pricingNow ? displayPriceUsdCents(pricingNow.ngQuarterly?.[planId] ?? "") : null;
  const ctx: SiteCheckoutCtx = { userId: user.id, email: user.email, planId, fwPlanId, paystackPlanCode, shownCents, market: paymentMarket(request.headers), country: paymentCountry(request.headers), billing: parsed.data.billing, fwPlanIdNgn, quarterCents, callbackUrl: `${base}/account?upgraded=1` };
  const out = await firstRail(
    candidates,
    (p) => (p === "flutterwave" ? openFlutterwaveSitePlan(ctx) : openPaystackSitePlan(ctx)),
    (from, to) => console.warn("[checkout] fallback_triggered", { from, to, userId: user.id }),
  );
  if (out.ok) return NextResponse.json(out.value);
  return NextResponse.json({ error: out.error, code: out.refusal === "unknown" ? "PAYMENT_CONFIRMING" : "PAYMENT_PROVIDER" }, { status: 503 });
}

interface SiteCheckoutCtx {
  userId: string;
  email: string;
  planId: "pro" | "business";
  fwPlanId: string;
  paystackPlanCode: string | null;
  /** the /pricing display price in US cents (null: not a plain USD amount) */
  shownCents: number | null;
  /** the member's market, from the edge (never the body) — Nigeria pays a one-off naira month (2026-10-24) */
  market: PaymentMarket;
  /** the edge's country — Ghana, Kenya, South Africa pay a one-off month in their own currency (2026-10-26) */
  country: string;
  /** Nigeria (and the local-currency countries): the pressed button; absent = one local-currency month */
  billing?: "renew" | "once" | "quarter";
  fwPlanIdNgn: string;
  /** the 3-month bundle price for Nigeria in US cents (Admin → Pricing); null = not offered */
  quarterCents: number | null;
  callbackUrl: string;
}
type SiteRail = RailAttempt<{ url: string; provider: "flutterwave" | "paystack" }>;
const NOT_STARTED = "Couldn't start checkout. Please try again.";
const NOT_CONFIRMED = "We couldn't confirm the payment page opened. Try again in a few minutes.";

/** The Flutterwave rail: the plan read from Flutterwave (USD, active, a fixed amount), the attempt written, then the hosted checkout on the payment plan. */
async function openFlutterwaveSitePlan(c: SiteCheckoutCtx): Promise<SiteRail> {
  /*
    Nigeria (2026-10-24), two buttons: "Bank transfer / USSD — 1 month" (the default) is one month paid once in naira;
    "Card — renews monthly" is a real subscription, on the NAIRA payment plan when one is set (else the USD plan).
  */
  const title = c.planId === "pro" ? "Frenz Pro" : "Frenz Business";
  // the 3-month bundle (Nigeria, 2026-10-24): three months paid once in naira at the bundle price; never anywhere else
  if (c.billing === "quarter") {
    const bundle = await openOneOffPlanCheckout({ market: c.market, purpose: "site_subscription", userId: c.userId, email: c.email, plan: c.planId, shownUsdCents: c.quarterCents, title, callbackUrl: c.callbackUrl, period: "quarterly" });
    return bundle ?? { ok: false, refusal: "definite", status: 409, error: "The 3-month bundle isn't available right now." };
  }
  if (c.billing !== "renew") {
    // Nigeria in naira; Ghana / Kenya / South Africa in their own currency (their cards often refuse a dollar subscription)
    const once = await openOneOffPlanCheckout({ market: c.market, country: c.country, purpose: "site_subscription", userId: c.userId, email: c.email, plan: c.planId, shownUsdCents: c.shownCents, title, callbackUrl: c.callbackUrl });
    if (once) return once;
  }
  const ngnPlan = c.market === "NG" && c.billing === "renew" ? c.fwPlanIdNgn : "";
  const fwPlanId = ngnPlan || c.fwPlanId;
  let facts;
  try {
    facts = await readFlutterwavePlan(fwPlanId);
  } catch (e) {
    // a read creates nothing — Paystack may follow
    console.warn("[checkout] flutterwave plan unreadable", { plan: c.planId, error: e instanceof Error ? e.name : "unknown" });
    return { ok: false, refusal: "definite", status: 503, error: NOT_STARTED };
  }
  // Part 6: active, USD, monthly, and its fixed amount EQUAL to the /pricing price members are shown — never a silent other amount
  // the naira card plan: its own fixed amount IS the price shown on the "Card — renews monthly" button (lib/payments/options.ts)
  const compat = ngnPlan ? flutterwavePlanCompat(facts, { amountMinor: facts.amountMinor ?? null, interval: "monthly" }, "NGN") : flutterwavePlanCompat(facts, { amountMinor: c.shownCents, interval: "monthly" });
  const amount = facts.amountMinor ?? 0;
  if (!compat.ok) {
    console.error("[checkout] flutterwave plan not usable", { plan: c.planId, reason: compat.reason, detail: compat.detail });
    return { ok: false, refusal: "definite", status: 503, error: NOT_STARTED };
  }
  const reference = newFlutterwaveReference("site_subscription");
  if (!(await recordPlanAttempt({ reference, userId: c.userId, plan: c.planId, listCents: amount, listCurrency: facts.currency, providerAmount: amount, providerCurrency: facts.currency, provider: "flutterwave", purpose: "site_subscription", providerPlanId: fwPlanId }))) {
    return { ok: false, refusal: "definite", status: 503, error: NOT_STARTED };
  }
  try {
    const url = await createFlutterwaveCheckout({ reference, amountMinor: amount, currency: facts.currency, email: c.email, redirectUrl: c.callbackUrl, title: c.planId === "pro" ? "Frenz Pro" : "Frenz Business", paymentPlan: fwPlanId, meta: { site_plan: c.planId } });
    await markPlanCheckout(reference, { url });
    return { ok: true, value: { url, provider: "flutterwave" } };
  } catch (e) {
    const definite = flutterwaveFailureIsDefinite(e);
    await markPlanCheckout(reference, { refused: definite });
    console.error("[checkout] flutterwave checkout failed", { plan: c.planId, definite, error: e instanceof Error ? e.name : "unknown" });
    return definite ? { ok: false, refusal: "definite", status: 503, error: NOT_STARTED } : { ok: false, refusal: "unknown", status: 503, error: NOT_CONFIRMED };
  }
}

/** The Paystack rail (the backup, NGN) — exactly as before: Paystack's subscription lifecycle drives the row. */
async function openPaystackSitePlan(c: SiteCheckoutCtx): Promise<SiteRail> {
  if (!c.paystackPlanCode) return { ok: false, refusal: "definite", status: 503, error: "That plan isn't available yet." };
  try {
    const url = await initializeTransaction({ email: c.email, planCode: c.paystackPlanCode, userId: c.userId, callbackUrl: c.callbackUrl });
    return { ok: true, value: { url, provider: "paystack" } };
  } catch (e) {
    // no attempt row on this rail (Paystack picks the reference); a refusal is safe to report, an unknown outcome too —
    // Paystack's subscription webhook alone activates the plan, so nothing is granted either way
    return { ok: false, refusal: paystackRefusedForSure(e) ? "definite" : "unknown", status: 503, error: NOT_STARTED };
  }
}
