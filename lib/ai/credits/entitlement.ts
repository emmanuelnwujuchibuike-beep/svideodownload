import "server-only";

import { type AiPlanId, type AiPlansConfig } from "@/lib/ai/credits/config";
import { calculateCredits, remainingAfter, type CreditEstimate, type CreditRequest } from "@/lib/ai/credits/engine";
import { currentPeriods, readAiCreditUsage } from "@/lib/ai/credits/store";
import { getAiSubscription, type AiSubscription } from "@/lib/ai/credits/subscription";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHAT A MEMBER'S AI PLAN LETS THEM DO RIGHT NOW
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The one read every surface uses — the quote (the estimate line), /start
 * (the decision), the credits route (the display), the admin monitor. The
 * plan comes from `ai_subscriptions`, the limits from the operator's plan
 * configuration AS IT IS NOW, the usage from the ledger under the current
 * period keys. Nothing from a browser.
 *
 * A member on no plan gets `plan: null` and zero limits; the wallet and the
 * complimentary creations are their routes, exactly as before this existed.
 */

export interface AiCreditEntitlement {
  enabled: boolean;
  plan: AiPlanId | null;
  planLabel: string | null;
  subscription: AiSubscription | null;
  dailyLimit: number;
  weeklyLimit: number;
  usedToday: number;
  usedThisWeek: number;
  remainingToday: number;
  remainingThisWeek: number;
  dayResetsAt: string;
  weekResetsAt: string;
  timezone: string;
}

export async function getAiCreditEntitlement(userId: string, config: AiPlansConfig, now: Date = new Date()): Promise<AiCreditEntitlement> {
  const periods = currentPeriods(config, now);
  const base: AiCreditEntitlement = {
    enabled: config.enabled,
    plan: null,
    planLabel: null,
    subscription: null,
    dailyLimit: 0,
    weeklyLimit: 0,
    usedToday: 0,
    usedThisWeek: 0,
    remainingToday: 0,
    remainingThisWeek: 0,
    dayResetsAt: periods.dayResetsAt.toISOString(),
    weekResetsAt: periods.weekResetsAt.toISOString(),
    timezone: periods.timezone,
  };
  if (!config.enabled) return base;
  const subscription = await getAiSubscription(userId);
  if (!subscription) return base;
  const planConfig = config.plans[subscription.plan];
  if (!subscription.active || !planConfig.enabled) return { ...base, subscription };
  const usage = await readAiCreditUsage(userId, config, now);
  return {
    ...base,
    plan: subscription.plan,
    planLabel: planConfig.label,
    subscription,
    dailyLimit: planConfig.dailyCredits,
    weeklyLimit: planConfig.weeklyCredits,
    usedToday: usage.usedToday,
    usedThisWeek: usage.usedThisWeek,
    remainingToday: Math.max(0, planConfig.dailyCredits - usage.usedToday),
    remainingThisWeek: Math.max(0, planConfig.weeklyCredits - usage.usedThisWeek),
  };
}

export interface CreditDecision {
  /** The member is on an active plan and the offer is on — credits are a route for this generation. */
  applicable: boolean;
  plan: AiPlanId | null;
  estimate: CreditEstimate;
  /** Both clocks cover it. */
  affordable: boolean;
  reason: "daily" | "weekly" | "no_plan" | "disabled" | null;
  remainingToday: number;
  remainingThisWeek: number;
  afterToday: number;
  afterThisWeek: number;
  dailyLimit: number;
  weeklyLimit: number;
  usedToday: number;
  usedThisWeek: number;
  dayResetsAt: string;
  weekResetsAt: string;
}

/** The estimate and whether the member's remaining allowance covers it — for the quote and for /start (which reserves atomically after). */
export function decideCredits(entitlement: AiCreditEntitlement, req: CreditRequest, config: AiPlansConfig): CreditDecision {
  const estimate = calculateCredits(req, config);
  if (!entitlement.enabled) {
    return { applicable: false, plan: null, estimate, affordable: false, reason: "disabled", remainingToday: 0, remainingThisWeek: 0, afterToday: 0, afterThisWeek: 0, dailyLimit: 0, weeklyLimit: 0, usedToday: 0, usedThisWeek: 0, dayResetsAt: entitlement.dayResetsAt, weekResetsAt: entitlement.weekResetsAt };
  }
  if (!entitlement.plan) {
    return { applicable: false, plan: null, estimate, affordable: false, reason: "no_plan", remainingToday: 0, remainingThisWeek: 0, afterToday: 0, afterThisWeek: 0, dailyLimit: 0, weeklyLimit: 0, usedToday: 0, usedThisWeek: 0, dayResetsAt: entitlement.dayResetsAt, weekResetsAt: entitlement.weekResetsAt };
  }
  const r = remainingAfter({ required: estimate.creditsRequired, dailyLimit: entitlement.dailyLimit, weeklyLimit: entitlement.weeklyLimit, usedToday: entitlement.usedToday, usedThisWeek: entitlement.usedThisWeek });
  return {
    applicable: true,
    plan: entitlement.plan,
    estimate,
    affordable: r.affordable,
    reason: r.reason,
    remainingToday: r.remainingToday,
    remainingThisWeek: r.remainingThisWeek,
    afterToday: r.afterToday,
    afterThisWeek: r.afterThisWeek,
    dailyLimit: entitlement.dailyLimit,
    weeklyLimit: entitlement.weeklyLimit,
    usedToday: entitlement.usedToday,
    usedThisWeek: entitlement.usedThisWeek,
    dayResetsAt: entitlement.dayResetsAt,
    weekResetsAt: entitlement.weekResetsAt,
  };
}

/** The credits block the quote and the start answer carry — display facts, never authority. */
export function creditDecisionView(d: CreditDecision) {
  return {
    applicable: d.applicable,
    plan: d.plan,
    required: d.estimate.creditsRequired,
    breakdown: d.estimate.breakdown,
    affordable: d.affordable,
    reason: d.reason,
    remainingToday: d.remainingToday,
    remainingThisWeek: d.remainingThisWeek,
    afterToday: d.afterToday,
    afterThisWeek: d.afterThisWeek,
    dailyLimit: d.dailyLimit,
    weeklyLimit: d.weeklyLimit,
    usedToday: d.usedToday,
    usedThisWeek: d.usedThisWeek,
    dayResetsAt: d.dayResetsAt,
    weekResetsAt: d.weekResetsAt,
  };
}

export type CreditDecisionView = ReturnType<typeof creditDecisionView>;
