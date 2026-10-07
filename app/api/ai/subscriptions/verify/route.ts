import { NextResponse } from "next/server";

import { activateBachsPlan, BACHS_PLAN_PREFIX } from "@/lib/ai/credits/bachs-plans";
import { getAiCreditEntitlement } from "@/lib/ai/credits/entitlement";
import { readBachsAttempt } from "@/lib/ai/wallet/bachs-topup";
import { bachsConfigured, bachsStatusIsPaid, getBachsCheckout } from "@/lib/payments/bachs";
import { activateAiPlanFromVerifiedCharge } from "@/lib/ai/credits/paystack";
import { getLandingSettings } from "@/lib/landing/settings";
import { paystackEnabled, verifyTransaction } from "@/lib/paystack/paystack";
import { aiJobReadLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/subscriptions/verify?reference=… — the member is back from
 * Paystack (0167). The charge is READ FROM PAYSTACK by its reference; the
 * return URL's own claims count for nothing. A success, for this member,
 * with the AI-plan purpose, activates the plan — idempotently with the
 * webhook (the same reference). Anything else answers what Paystack said.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const burst = await aiJobReadLimiter.limit(`ai-plan-verify:${user.id}`);
  if (!burst.success) return NextResponse.json({ error: "Too many attempts." }, { status: 429 });
  const reference = new URL(request.url).searchParams.get("reference")?.trim() ?? "";
  if (!/^[A-Za-z0-9_.-]{6,120}$/.test(reference)) return NextResponse.json({ error: "Invalid reference." }, { status: 400 });

  /*
    ── BACHS (2026-10-07) ─────────────────────────────────────────────────
    Our own reference → the attempt row (whose, which plan) → the checkout as
    Bachs holds it now. Only SUCCEEDED activates, through the same store and
    the same once-only reference as the webhook; anything else is "not yet" —
    the signed webhook will activate it. The return alone is never proof.
  */
  if (reference.startsWith(BACHS_PLAN_PREFIX)) {
    try {
      const settings = await getLandingSettings();
      const attempt = await readBachsAttempt(reference);
      if (!attempt || attempt.user_id !== user.id || attempt.purpose !== "ai_subscription") return NextResponse.json({ activated: false, status: "unknown" });
      if (!attempt.external_id || !bachsConfigured()) return NextResponse.json({ activated: false, status: "pending" });
      const session = await getBachsCheckout(attempt.external_id);
      if (!bachsStatusIsPaid(session.status)) return NextResponse.json({ activated: false, status: "pending" });
      const customer = (session.raw.customer ?? null) as { id?: unknown } | null;
      const outcome = await activateBachsPlan(attempt, settings.frenzAiPlans, { customerId: typeof customer?.id === "string" ? customer.id : null, via: "return" });
      if (!outcome.ok) return NextResponse.json({ activated: false, status: "unknown", reason: outcome.reason });
      const entitlement = await getAiCreditEntitlement(user.id, settings.frenzAiPlans);
      return NextResponse.json({ activated: true, plan: outcome.plan, planLabel: settings.frenzAiPlans.plans[outcome.plan].label, dailyLimit: entitlement.dailyLimit, weeklyLimit: entitlement.weeklyLimit });
    } catch (e) {
      console.error("[ai/plans] bachs verify threw", { userId: user.id, reference, error: String(e).slice(0, 200) });
      return NextResponse.json({ error: "We couldn't confirm the payment yet. It will activate automatically once it is confirmed." }, { status: 503 });
    }
  }

  if (!(await paystackEnabled())) return NextResponse.json({ error: "Billing isn't available yet." }, { status: 503 });
  try {
    const settings = await getLandingSettings();
    const charge = await verifyTransaction(reference);
    const outcome = await activateAiPlanFromVerifiedCharge(user.id, charge, settings.frenzAiPlans);
    if (!outcome.ok) {
      console.info("[ai/plans] verify did not activate", { userId: user.id, reference, reason: outcome.reason, status: charge.status ?? null });
      return NextResponse.json({ activated: false, status: charge.status ?? "unknown", reason: charge.gateway_response ?? null });
    }
    const entitlement = await getAiCreditEntitlement(user.id, settings.frenzAiPlans);
    console.info("[ai/plans] activated on return", { userId: user.id, plan: outcome.plan, reference });
    return NextResponse.json({ activated: true, plan: outcome.plan, planLabel: settings.frenzAiPlans.plans[outcome.plan].label, dailyLimit: entitlement.dailyLimit, weeklyLimit: entitlement.weeklyLimit });
  } catch (e) {
    console.error("[ai/plans] verify threw", { userId: user.id, reference, error: String(e).slice(0, 200) });
    return NextResponse.json({ error: "We couldn't confirm the payment yet. It will activate automatically once Paystack confirms it." }, { status: 503 });
  }
}
