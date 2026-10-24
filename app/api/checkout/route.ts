import { NextResponse } from "next/server";
import { z } from "zod";

import { markPlanCheckout, recordPlanAttempt, resolvePlanCheckout } from "@/lib/ai/credits/plan-attempts";
import { createFlutterwaveCheckout, flutterwaveFailureIsDefinite, readFlutterwavePlan } from "@/lib/flutterwave/client";
import { FLUTTERWAVE_CHECKOUT_CURRENCY, flutterwaveUsableFor, getFlutterwaveConfig } from "@/lib/flutterwave/config";
import { getLandingSettings } from "@/lib/landing/settings";
import { getUserPlan, planRank } from "@/lib/monetization/plan";
import { getPricing } from "@/lib/monetization/pricing";
import { displayPriceUsdCents, flutterwavePlanCompat } from "@/lib/payments/plan-compat";
import { newFlutterwaveReference } from "@/lib/payments/references";
import { firstRail, paymentMarket, routePayment, type RailAttempt } from "@/lib/payments/router";
import { initializeTransaction, paystackEnabled, paystackRefusedForSure, planCodeForPlan } from "@/lib/paystack/paystack";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// `provider` is only a preference among the rails offered (Flutterwave first, Paystack the backup) — how a member paying by
// bank transfer or USSD (which Flutterwave payment plans can't take) reaches Paystack
const schema = z.object({ plan: z.enum(["pro", "business"]), provider: z.string().max(20).optional() });

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
  const flutterwaveOk = sameRail !== "paystack" && flutterwaveUsableFor("site_subscription", fw) && !!fwPlanId;
  const paystackPlanCode = sameRail !== "flutterwave" && (await paystackEnabled()) ? await planCodeForPlan(planId) : null;
  const settings = await getLandingSettings();
  const wallet = settings.frenzAiPlans.wallet;
  const candidates = routePayment({ purpose: "site_subscription", market: paymentMarket(request.headers), routing: wallet.routing, usable: (p) => (p === "flutterwave" ? flutterwaveOk : p === "paystack" && !!paystackPlanCode), preferred: wallet.memberChoice ? parsed.data.provider : undefined });
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
  const shownCents = flutterwaveOk ? displayPriceUsdCents((await getPricing())[planId].price) : null;
  const ctx: SiteCheckoutCtx = { userId: user.id, email: user.email, planId, fwPlanId, paystackPlanCode, shownCents, callbackUrl: `${base}/account?upgraded=1` };
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
  callbackUrl: string;
}
type SiteRail = RailAttempt<{ url: string; provider: "flutterwave" | "paystack" }>;
const NOT_STARTED = "Couldn't start checkout. Please try again.";
const NOT_CONFIRMED = "We couldn't confirm the payment page opened. Try again in a few minutes.";

/** The Flutterwave rail: the plan read from Flutterwave (USD, active, a fixed amount), the attempt written, then the hosted checkout on the payment plan. */
async function openFlutterwaveSitePlan(c: SiteCheckoutCtx): Promise<SiteRail> {
  let facts;
  try {
    facts = await readFlutterwavePlan(c.fwPlanId);
  } catch (e) {
    // a read creates nothing — Paystack may follow
    console.warn("[checkout] flutterwave plan unreadable", { plan: c.planId, error: e instanceof Error ? e.name : "unknown" });
    return { ok: false, refusal: "definite", status: 503, error: NOT_STARTED };
  }
  // Part 6: active, USD, monthly, and its fixed amount EQUAL to the /pricing price members are shown — never a silent other amount
  const compat = flutterwavePlanCompat(facts, { amountMinor: c.shownCents, interval: "monthly" });
  const amount = facts.amountMinor ?? 0;
  if (!compat.ok) {
    console.error("[checkout] flutterwave plan not usable", { plan: c.planId, reason: compat.reason, detail: compat.detail });
    return { ok: false, refusal: "definite", status: 503, error: NOT_STARTED };
  }
  const reference = newFlutterwaveReference("site_subscription");
  if (!(await recordPlanAttempt({ reference, userId: c.userId, plan: c.planId, listCents: amount, listCurrency: FLUTTERWAVE_CHECKOUT_CURRENCY, providerAmount: amount, providerCurrency: FLUTTERWAVE_CHECKOUT_CURRENCY, provider: "flutterwave", purpose: "site_subscription", providerPlanId: c.fwPlanId }))) {
    return { ok: false, refusal: "definite", status: 503, error: NOT_STARTED };
  }
  try {
    const url = await createFlutterwaveCheckout({ reference, amountMinor: amount, currency: FLUTTERWAVE_CHECKOUT_CURRENCY, email: c.email, redirectUrl: c.callbackUrl, title: c.planId === "pro" ? "Frenz Pro" : "Frenz Business", paymentPlan: c.fwPlanId, meta: { site_plan: c.planId } });
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
