import { NextResponse } from "next/server";
import { z } from "zod";

import { aiPlanRank } from "@/lib/ai/credits/config";
import { AI_PLAN_PURPOSE } from "@/lib/ai/credits/paystack";
import { getAiSubscription } from "@/lib/ai/credits/subscription";
import { getLandingSettings } from "@/lib/landing/settings";
import { initializeTransaction, isPaystackPlanNotFound, paystackEnabled } from "@/lib/paystack/paystack";
import { aiJobCreateLimiter } from "@/lib/rate-limit";
import { SITE_URL } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/subscriptions/checkout — start an AI Pro / AI Max subscription
 * (0167). The plan id is the only thing the body may say; the price, the
 * plan code and the metadata come from the operator's configuration and the
 * session. The member is sent to Paystack's hosted page; nothing is
 * activated here — the webhook and the verify-on-return route do that
 * after Paystack confirms the charge.
 */
const schema = z.object({ plan: z.enum(["ai_pro", "ai_max"]), returnTo: z.string().max(200).optional() }).strict();

export async function POST(request: Request) {
  if (!(await paystackEnabled())) return NextResponse.json({ error: "Billing isn't available yet." }, { status: 503 });
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
  if (!plan.paystackPlanCode) return NextResponse.json({ error: "That plan isn't available for purchase yet." }, { status: 503 });
  // A member already on this plan, or a higher one, has nothing to buy here (a change of plan goes through the manage link).
  const current = await getAiSubscription(user.id);
  if (current?.active && aiPlanRank(current.plan) >= aiPlanRank(parsed.data.plan)) {
    return NextResponse.json({ error: `You're already on ${plans.plans[current.plan].label}.`, alreadyOn: current.plan }, { status: 409 });
  }

  try {
    const base = SITE_URL || new URL(request.url).origin;
    // only a path on this site may be the return; anything else goes to the usage page
    const returnTo = parsed.data.returnTo && /^\/(?!\/)[A-Za-z0-9\-._~/?#[\]@!$&'()*+,;=%]*$/.test(parsed.data.returnTo) ? parsed.data.returnTo : "/studio/ai/usage";
    const url = await initializeTransaction({
      email: user.email,
      planCode: plan.paystackPlanCode,
      userId: user.id,
      callbackUrl: `${base}${returnTo}${returnTo.includes("?") ? "&" : "?"}ai_plan=${parsed.data.plan}`,
      metadata: { purpose: AI_PLAN_PURPOSE, ai_plan: parsed.data.plan },
    });
    console.info("[ai/plans] checkout started", { userId: user.id, plan: parsed.data.plan });
    return NextResponse.json({ url });
  } catch (e) {
    /*
      ── 🔴 NEVER 502 FROM HERE (2026-09-21) ────────────────────────────────
      Cloudflare replaces an origin 502 with its own HTML error page, so the
      JSON sentence below never reached the sheet — the member saw a generic
      "Something went wrong". 503 passes through. And the usual cause is
      named: a plan code Paystack does not know (the owner had pasted a
      payment-page slug where a PLN_… code belongs) is a configuration
      fault, told to the operator in the log and to the member honestly.
    */
    const planNotFound = isPaystackPlanNotFound(e);
    console.error("[ai/plans] checkout failed", { userId: user.id, plan: parsed.data.plan, planNotFound, error: String(e).slice(0, 200) });
    return NextResponse.json(
      {
        error: planNotFound ? "This plan isn't set up for purchase yet — we're on it. Nothing was charged." : "Couldn't start checkout. Please try again in a moment.",
        code: planNotFound ? "PLAN_NOT_CONFIGURED" : "PAYMENT_PROVIDER",
      },
      { status: 503 },
    );
  }
}
