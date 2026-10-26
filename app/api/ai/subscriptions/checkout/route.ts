import { NextResponse } from "next/server";
import { z } from "zod";

import { aiPlanRank, type AiPlanConfig, type AiPlanId } from "@/lib/ai/credits/config";
import { AI_PLAN_PURPOSE } from "@/lib/ai/credits/paystack";
import { getAiSubscription } from "@/lib/ai/credits/subscription";
import { getLandingSettings } from "@/lib/landing/settings";
import { markPlanCheckout, newPlanReference, recordPlanAttempt, resolvePlanCheckout } from "@/lib/ai/credits/plan-attempts";
import { createFlutterwaveCheckout, flutterwaveFailureIsDefinite, readFlutterwavePlan } from "@/lib/flutterwave/client";
import { FLUTTERWAVE_CHECKOUT_CURRENCY, flutterwaveUsableFor, getFlutterwaveConfig } from "@/lib/flutterwave/config";
import { initializeTransaction, isPaystackPlanNotFound, paystackEnabled, paystackRefusedForSure, readPaystackPlan } from "@/lib/paystack/paystack";
import { openOneOffPlanCheckout } from "@/lib/ai/credits/plan-oneoff";
import type { PaymentMarket } from "@/lib/ai/credits/wallet-config";
import { aiPlanShownUsdCents, flutterwavePlanCompat } from "@/lib/payments/plan-compat";
import { newFlutterwaveReference } from "@/lib/payments/references";
import { firstRail, paymentCountry, paymentMarket, routePayment, type RailAttempt } from "@/lib/payments/router";
import { aiJobCreateLimiter } from "@/lib/rate-limit";
import { SITE_URL } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/subscriptions/checkout — start an AI Pro / AI Max subscription
 * (0167). The plan id is the only thing the body may say; the price, the
 * plan code and the metadata come from the operator's configuration and the
 * session. The member is sent to Flutterwave's (USD, card) or — the backup —
 * Paystack's (NGN) hosted page; nothing is activated here: the webhooks, the
 * verify-on-return route and the cron do that after the provider's own record
 * confirms the charge, exactly.
 */
// `provider` is only a preference the router may honour among what it offers (Flutterwave first, Paystack the backup);
// a cached app still sending "bachs" is not refused — the preference is simply not offered
// billing (2026-10-24): the button a member in Nigeria pressed — "renew" (card, monthly subscription) or "once" (one naira month). Never a price.
const schema = z.object({ plan: z.enum(["ai_pro", "ai_max"]), returnTo: z.string().max(200).optional(), provider: z.string().max(20).optional(), billing: z.enum(["renew", "once"]).optional() }).strict();

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in first.", login: true }, { status: 401 });
  if (!user.email) return NextResponse.json({ error: "Your account needs an email to subscribe." }, { status: 400 });
  const burst = await aiJobCreateLimiter.limit(`ai-plan-checkout:${user.id}`);
  if (!burst.success) return NextResponse.json({ error: "Too many attempts. Try again in a minute." }, { status: 429 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid plan." }, { status: 400 });

  const settings = await getLandingSettings();
  const plans = settings.frenzAiPlans;
  const plan = plans.plans[parsed.data.plan];
  if (!plans.enabled || !plan.enabled) return NextResponse.json({ error: "That plan isn't available right now." }, { status: 503 });
  // A member already on this plan, or a higher one, has nothing to buy here (a change of plan goes through the manage link).
  const current = await getAiSubscription(user.id);
  if (current?.active && aiPlanRank(current.plan) >= aiPlanRank(parsed.data.plan)) {
    return NextResponse.json({ error: `You're already on ${plans.plans[current.plan].label}.`, alreadyOn: current.plan }, { status: 409 });
  }

  const base = SITE_URL || new URL(request.url).origin;
  // only a path on this site may be the return; anything else goes to the usage page
  const returnTo = parsed.data.returnTo && /^\/(?!\/)[A-Za-z0-9\-._~/?#[\]@!$&'()*+,;=%]*$/.test(parsed.data.returnTo) ? parsed.data.returnTo : "/studio/ai/usage";

  /*
    ── WHICH RAIL (owner, 2026-10-23) ─────────────────────────────────────────
    "Plans should be sent to Flutterwave not paystack, paystack only when Flutterwave is not available or doesn't
    have the user's supported payment method." Flutterwave first: a USD payment plan, CARD only — usable when its
    account capability gate allows AI plans AND the plan carries a Flutterwave plan id. Paystack (NGN, card / bank /
    transfer) is the backup: when Flutterwave is not usable, when it DEFINITELY refused, or when the member picked it
    (the payment choice — how a member paying by bank transfer or USSD gets a method Flutterwave plans can't take).
    An unknown Flutterwave outcome (timeout / 5xx) is held, never sent to Paystack.
  */
  /*
    Part 3.3: an UPGRADE stays on the rail that bills the current plan. Opening the new plan on the other provider would
    leave the old subscription charging there — and neither provider can cancel the other's. (A Flutterwave → Flutterwave
    upgrade cancels the old subscription by its stored id once the new one is active.)
  */
  const sameRail = current?.active && (current.provider === "paystack" || current.provider === "flutterwave") ? current.provider : null;
  const flutterwaveOk = sameRail !== "paystack" && flutterwaveUsableFor("ai_subscription", await getFlutterwaveConfig()) && !!plan.flutterwavePlanId;
  const paystackOk = sameRail !== "flutterwave" && (await paystackEnabled()) && !!plan.paystackPlanCode;
  const candidates = routePayment({ purpose: "ai_subscription", market: paymentMarket(request.headers), routing: plans.wallet.routing, usable: (p) => (p === "flutterwave" ? flutterwaveOk : p === "paystack" && paystackOk), preferred: plans.wallet.memberChoice ? parsed.data.provider : undefined });
  if (!candidates.length) return NextResponse.json({ error: "That plan isn't available for purchase yet." }, { status: 503 });

  /*
    ── Part 3: an open attempt first ─────────────────────────────────────────
    An open checkout for this plan is handed back; one whose creation outcome was unknown is resolved
    first (lib/ai/credits/plan-attempts.ts) — never a second checkout while the first might be paid.
  */
  const open = await resolvePlanCheckout(user.id, parsed.data.plan, plans);
  if (open.kind === "reuse") return NextResponse.json({ url: open.url, reused: true });
  if (open.kind === "activated") return NextResponse.json({ error: `You're already on ${plan.label}.`, alreadyOn: parsed.data.plan }, { status: 409 });
  if (open.kind === "held") return NextResponse.json({ error: "Your last payment is still being confirmed. Try again in a few minutes.", code: "PAYMENT_CONFIRMING" }, { status: 409 });

  const ctx: PlanCheckoutCtx = { userId: user.id, email: user.email, planId: parsed.data.plan, plan, listCurrency: settings.frenzAiCurrency, market: paymentMarket(request.headers), country: paymentCountry(request.headers), billing: parsed.data.billing, callbackUrl: `${base}${returnTo}${returnTo.includes("?") ? "&" : "?"}ai_plan=${parsed.data.plan}` };
  const out = await firstRail(
    candidates,
    (p) => (p === "flutterwave" ? openFlutterwavePlan(ctx) : openPaystackPlan(ctx)),
    (from, to) => console.warn("[ai/plans] fallback_triggered", { from, to, userId: user.id }),
  );
  if (out.ok) {
    console.info("[ai/plans] checkout started", { userId: user.id, plan: parsed.data.plan, provider: out.value.provider });
    return NextResponse.json(out.value);
  }
  /* 🔴 NEVER 502 FROM HERE (2026-09-21): Cloudflare replaces an origin 502 with its own HTML page; 503 passes through. */
  const code = out.refusal === "unknown" ? "PAYMENT_CONFIRMING" : out.error === PLAN_NOT_SET_UP ? "PLAN_NOT_CONFIGURED" : "PAYMENT_PROVIDER";
  return NextResponse.json({ error: out.error, code }, { status: 503 });
}

interface PlanCheckoutCtx {
  userId: string;
  email: string;
  planId: AiPlanId;
  plan: AiPlanConfig;
  listCurrency: string;
  /** the member's market, from the edge (never the body) — Nigeria pays a one-off naira month (2026-10-24) */
  market: PaymentMarket;
  /** the edge's country — Ghana, Kenya, South Africa pay a one-off month in their own currency (2026-10-26) */
  country: string;
  /** Nigeria (and the local-currency countries): the pressed button; absent = one local-currency month */
  billing?: "renew" | "once";
  callbackUrl: string;
}
type PlanRail = RailAttempt<{ url: string; provider: "flutterwave" | "paystack" }>;
const NOT_STARTED = "Couldn't start checkout. Please try again in a moment.";
const PLAN_NOT_SET_UP = "This plan isn't set up for purchase yet — we're on it. Nothing was charged.";
const NOT_CONFIRMED = "We couldn't confirm the payment page opened. Try again in a few minutes.";

/** The Flutterwave rail: the plan read from Flutterwave (USD, active), the attempt written, then the hosted checkout on the payment plan. */
async function openFlutterwavePlan(c: PlanCheckoutCtx): Promise<PlanRail> {
  /*
    Nigeria (2026-10-24), two buttons: "Bank transfer / USSD — 1 month" (the default) is one month paid once in naira;
    "Card — renews monthly" is a real subscription, on the NAIRA payment plan when one is set (else the USD plan).
    null from the one-off path = it does not apply → the subscription below.
  */
  if (c.billing !== "renew") {
    const once = await openOneOffPlanCheckout({ market: c.market, country: c.country, purpose: "ai_subscription", userId: c.userId, email: c.email, plan: c.planId, shownUsdCents: aiPlanShownUsdCents(c.plan.priceCents, c.listCurrency), title: `Frenz ${c.plan.label}`, callbackUrl: c.callbackUrl });
    if (once) return once;
  }
  const ngnPlan = c.market === "NG" && c.billing === "renew" ? c.plan.flutterwavePlanIdNgn : "";
  const fwPlanId = ngnPlan || c.plan.flutterwavePlanId;
  let facts;
  try {
    facts = await readFlutterwavePlan(fwPlanId);
  } catch (e) {
    // a read creates nothing — Paystack may follow
    console.warn("[ai/plans] flutterwave plan unreadable", { plan: c.planId, error: e instanceof Error ? e.name : "unknown" });
    return { ok: false, refusal: "definite", status: 503, error: NOT_STARTED };
  }
  /*
    The charge must be in the plan's currency (Flutterwave charges USD here) and at the plan's OWN FIXED amount — the
    same rule as Pro / Business (Part 3.3.2, M1). A plan without one is never charged at a substitute (the admin list
    price): what Flutterwave renews such a subscription at is not documented. Refused BEFORE any attempt or checkout, so
    nothing was started there and Paystack may follow.
  */
  // Part 6: and at EXACTLY the plan's list price members are shown (priceCents, when the AI prices are in USD) — never a silent other amount
  // the naira card plan: its own fixed amount IS the price shown on the "Card — renews monthly" button (lib/payments/options.ts)
  const compat = ngnPlan ? flutterwavePlanCompat(facts, { amountMinor: facts.amountMinor ?? null, interval: c.plan.interval }, "NGN") : flutterwavePlanCompat(facts, { amountMinor: aiPlanShownUsdCents(c.plan.priceCents, c.listCurrency), interval: c.plan.interval });
  const amount = facts.amountMinor ?? 0;
  if (!compat.ok) {
    console.error("[ai/plans] flutterwave plan not usable", { plan: c.planId, reason: compat.reason, detail: compat.detail });
    return { ok: false, refusal: "definite", status: 503, error: NOT_STARTED };
  }
  const reference = newFlutterwaveReference("ai_subscription");
  if (!(await recordPlanAttempt({ reference, userId: c.userId, plan: c.planId, listCents: c.plan.priceCents, listCurrency: c.listCurrency, providerAmount: amount, providerCurrency: facts.currency, provider: "flutterwave", providerPlanId: fwPlanId }))) {
    return { ok: false, refusal: "definite", status: 503, error: NOT_STARTED };
  }
  try {
    const url = await createFlutterwaveCheckout({ reference, amountMinor: amount, currency: facts.currency, email: c.email, redirectUrl: c.callbackUrl, title: `Frenz ${c.plan.label}`, paymentPlan: fwPlanId, meta: { ai_plan: c.planId } });
    await markPlanCheckout(reference, { url });
    return { ok: true, value: { url, provider: "flutterwave" } };
  } catch (e) {
    const definite = flutterwaveFailureIsDefinite(e);
    await markPlanCheckout(reference, { refused: definite });
    console.error("[ai/plans] flutterwave checkout failed", { plan: c.planId, definite, error: e instanceof Error ? e.name : "unknown" });
    return definite ? { ok: false, refusal: "definite", status: 503, error: NOT_STARTED } : { ok: false, refusal: "unknown", status: 503, error: NOT_CONFIRMED };
  }
}

/** The Paystack rail (the backup, NGN): the exact plan charge read from Paystack, the attempt written, then Paystack with our reference. */
async function openPaystackPlan(c: PlanCheckoutCtx): Promise<PlanRail> {
  let facts;
  try {
    facts = await readPaystackPlan(c.plan.paystackPlanCode);
    if (!(facts.amount > 0) || !/^[A-Z]{3}$/.test(facts.currency)) throw new Error("plan not found: no amount or currency");
  } catch (e) {
    // a plan code Paystack does not know (a payment-page slug pasted where a PLN_… code belongs) is named for what it is
    const planNotFound = isPaystackPlanNotFound(e);
    console.error("[ai/plans] paystack plan unreadable", { plan: c.planId, planNotFound, error: String(e).slice(0, 200) });
    return { ok: false, refusal: "definite", status: 503, error: planNotFound ? PLAN_NOT_SET_UP : NOT_STARTED };
  }
  const reference = newPlanReference();
  if (!(await recordPlanAttempt({ reference, userId: c.userId, plan: c.planId, listCents: c.plan.priceCents, listCurrency: c.listCurrency, providerAmount: facts.amount, providerCurrency: facts.currency }))) {
    return { ok: false, refusal: "definite", status: 503, error: NOT_STARTED };
  }
  try {
    const url = await initializeTransaction({ email: c.email, planCode: c.plan.paystackPlanCode, userId: c.userId, callbackUrl: c.callbackUrl, metadata: { purpose: AI_PLAN_PURPOSE, ai_plan: c.planId }, reference, amount: facts.amount });
    await markPlanCheckout(reference, { url });
    return { ok: true, value: { url, provider: "paystack" } };
  } catch (e) {
    // only Paystack's own 4xx is a refusal; a timeout / 5xx is unknown → held for verification
    const definite = paystackRefusedForSure(e);
    await markPlanCheckout(reference, { refused: definite });
    const planNotFound = isPaystackPlanNotFound(e);
    console.error("[ai/plans] paystack checkout failed", { plan: c.planId, definite, planNotFound, error: String(e).slice(0, 200) });
    return { ok: false, refusal: definite ? "definite" : "unknown", status: 503, error: planNotFound ? PLAN_NOT_SET_UP : definite ? NOT_STARTED : NOT_CONFIRMED };
  }
}
