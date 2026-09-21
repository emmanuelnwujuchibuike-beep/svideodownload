import { NextResponse } from "next/server";

import { publicAiPlansConfig } from "@/lib/ai/credits/config";
import { getAiCreditEntitlement } from "@/lib/ai/credits/entitlement";
import { listOwnCreditLedger } from "@/lib/ai/credits/store";
import { aiErrorBody, aiErrorStatus } from "@/lib/ai/errors";
import { aiFeature } from "@/lib/ai/jobs";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { aiCurrencySymbol, getLandingSettings } from "@/lib/landing/settings";
import { aiJobReadLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/credits — the member's AI plan and allowance, as the server
 * holds them (0167): which plan, its daily and weekly credits, what is used
 * on both clocks under the operator's reset zone, when each resets, and the
 * recent credit transactions. Plus the plan catalogue (prices and allowances
 * from the admin configuration) for the plan cards — never a plan code.
 *
 * Display only. Every decision that spends is /start's, made again against
 * the same tables at the moment it matters.
 */
export async function GET(request: Request) {
  const feature = aiFeature("ai_character_replace");
  if (!feature) return NextResponse.json(aiErrorBody("FEATURE_UNAVAILABLE"), { status: aiErrorStatus("FEATURE_UNAVAILABLE") });
  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") return NextResponse.json(aiErrorBody("AUTH_REQUIRED"), { status: aiErrorStatus("AUTH_REQUIRED") });
  const burst = await aiJobReadLimiter.limit(`ai-credits:${subject.key}`);
  if (!burst.success) {
    return NextResponse.json(aiErrorBody("RATE_LIMITED"), { status: aiErrorStatus("RATE_LIMITED"), headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) } });
  }
  try {
    const settings = await getLandingSettings();
    const plans = settings.frenzAiPlans;
    const currency = { code: settings.frenzAiCurrency, symbol: aiCurrencySymbol(settings.frenzAiCurrency) };
    const ledgerParam = Number(new URL(request.url).searchParams.get("ledger") ?? "");
    const [entitlement, ledger] = await Promise.all([getAiCreditEntitlement(subject.userId, plans), Number.isFinite(ledgerParam) && ledgerParam > 0 ? listOwnCreditLedger(subject.userId, Math.min(100, Math.floor(ledgerParam))) : Promise.resolve([])]);
    return NextResponse.json(
      {
        plans: publicAiPlansConfig(plans, currency),
        entitlement: {
          plan: entitlement.plan,
          planLabel: entitlement.planLabel,
          dailyLimit: entitlement.dailyLimit,
          weeklyLimit: entitlement.weeklyLimit,
          usedToday: entitlement.usedToday,
          usedThisWeek: entitlement.usedThisWeek,
          remainingToday: entitlement.remainingToday,
          remainingThisWeek: entitlement.remainingThisWeek,
          dayResetsAt: entitlement.dayResetsAt,
          weekResetsAt: entitlement.weekResetsAt,
          timezone: entitlement.timezone,
          subscription: entitlement.subscription
            ? { plan: entitlement.subscription.plan, status: entitlement.subscription.status, active: entitlement.subscription.active, currentPeriodEnd: entitlement.subscription.currentPeriodEnd, cancelAtPeriodEnd: entitlement.subscription.cancelAtPeriodEnd, manageable: !!entitlement.subscription.subscriptionRef }
            : null,
        },
        ledger: ledger.map((r) => ({ id: r.id, jobId: r.job_id, feature: r.feature, plan: r.plan, reserved: r.credits_reserved, consumed: r.credits_consumed, refunded: r.credits_refunded, status: r.status, dayKey: r.day_key, weekKey: r.week_key, at: r.created_at, updatedAt: r.updated_at })),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    console.error("[ai/credits] read failed", { subject: subject.key, error: String(e).slice(0, 200) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}
