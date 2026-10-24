import { NextResponse } from "next/server";

import { getAiCreditEntitlement } from "@/lib/ai/credits/entitlement";
import { activateAiPlanFromVerifiedCharge } from "@/lib/ai/credits/paystack";
import { isPlanReference, settleOwnPlanAttempt } from "@/lib/ai/credits/plan-attempts";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLandingSettings } from "@/lib/landing/settings";
import { isRemovedProviderReference } from "@/lib/payments/removed-providers";
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

  // a removed provider's reference (Bachs, 2026-10-17): "pending", no network call, no write — never the Paystack path
  if (isRemovedProviderReference(reference)) return NextResponse.json({ activated: false, status: "pending" });

  if (!(await paystackEnabled())) return NextResponse.json({ error: "Billing isn't available yet." }, { status: 503 });
  try {
    const settings = await getLandingSettings();
    /*
      Part 3: a checkout started since attempts exist carries OUR reference (frenz_ai_plan_…). It settles through its
      attempt row — the exact amount, the plan, the member — the same routine the cron sweep uses; the browser's
      return proves nothing. An older Paystack-chosen reference keeps the path below, unchanged.
    */
    if (isPlanReference(reference)) {
      const o = await settleOwnPlanAttempt(user.id, reference, settings.frenzAiPlans);
      if (o !== "settled") return NextResponse.json({ activated: false, status: o === "failed" ? "failed" : o === "mismatched" ? "review" : "pending", reason: null });
      const sub = await getAiCreditEntitlement(user.id, settings.frenzAiPlans);
      const { data } = await createAdminClient().from("ai_topup_attempts").select("item_id").eq("reference", reference).maybeSingle();
      const plan = (data as { item_id?: string } | null)?.item_id === "ai_max" ? "ai_max" : "ai_pro";
      return NextResponse.json({ activated: true, plan, planLabel: settings.frenzAiPlans.plans[plan].label, dailyLimit: sub.dailyLimit, weeklyLimit: sub.weeklyLimit });
    }
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
