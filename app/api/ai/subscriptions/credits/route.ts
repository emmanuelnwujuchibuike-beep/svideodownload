import { after, NextResponse } from "next/server";
import { z } from "zod";

import { welcomeAiPlan } from "@/lib/ai/credits/plan-welcome";
import { getLandingSettings } from "@/lib/landing/settings";
import { aiJobCreateLimiter } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ plan: z.enum(["ai_pro", "ai_max"]) }).strict();

/** The price of one period in credits — the plan's USD price at the credit rate, rounded UP (a member never pays less than the price). */
function planPriceCredits(priceCents: number, centsPerCredit: number): number {
  return Math.ceil(Math.max(0, priceCents) / Math.max(1, centsPerCredit));
}

function periodEnd(interval: "monthly" | "yearly", from = new Date()): Date {
  const d = new Date(from);
  if (interval === "yearly") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

/**
 * POST /api/ai/subscriptions/credits — pay for ONE period of AI Pro / AI Max
 * with wallet credits (owner, 2026-10-07: "they can … use them for
 * subscription"). The body names the plan and nothing else: the price is the
 * operator's (the plan's USD price at the credit rate), and the debit, the
 * "already on this plan" check and the activation are one SQL transaction
 * (`buy_ai_plan_with_credits`, 0192). A credits plan never renews by itself.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in first.", login: true }, { status: 401 });
  const burst = await aiJobCreateLimiter.limit(`ai-plan-credits:${user.id}`);
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
  const credits = planPriceCredits(plan.priceCents, plans.credits.centsPerCredit);
  const end = periodEnd(plan.interval);

  const { data, error } = await createAdminClient().rpc("buy_ai_plan_with_credits", {
    p_user: user.id,
    p_plan: parsed.data.plan,
    p_credits: credits,
    p_period_end: end.toISOString(),
    p_label: `${plan.label} · ${plan.interval === "yearly" ? "1 year" : "1 month"} with credits`,
  });
  if (error) {
    console.error("[ai/plans] credits purchase failed", { userId: user.id, plan: parsed.data.plan, message: error.message });
    return NextResponse.json({ error: "Couldn't complete that right now. Nothing was taken." }, { status: 503 });
  }
  const out = data as { ok: boolean; reason?: string; balance?: number; balance_after?: number };
  if (!out.ok) {
    const msg =
      out.reason === "insufficient"
        ? `You need ${credits.toLocaleString("en-US")} credits for ${plan.label} — you have ${Number(out.balance ?? 0).toLocaleString("en-US")}.`
        : out.reason === "already_on_plan"
          ? "You're already on this plan or a higher one."
          : "That plan can't be bought with credits right now.";
    return NextResponse.json({ error: msg, reason: out.reason, credits }, { status: out.reason === "insufficient" ? 402 : 409 });
  }
  console.info("[ai/plans] bought with credits", { userId: user.id, plan: parsed.data.plan, credits });
  after(() => welcomeAiPlan(user.id, parsed.data.plan, plans));
  return NextResponse.json({ ok: true, plan: parsed.data.plan, planLabel: plan.label, credits, balanceAfter: out.balance_after ?? null, periodEnd: end.toISOString() });
}
