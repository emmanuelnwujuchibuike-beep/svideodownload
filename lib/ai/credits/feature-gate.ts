import "server-only";

import type { AiPlansConfig } from "@/lib/ai/credits/config";
import { featureAccess, featurePolicy, includedPeriodKey, publicFeatureAccess, tierOf, type AiFeaturePolicy, type AiTier, type FeatureAccess } from "@/lib/ai/credits/features";
import { readIncludedUsed } from "@/lib/ai/credits/included";
import { getAiSubscription, type AiSubscription } from "@/lib/ai/credits/subscription";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ONE QUESTION EVERY PAID TOOL ASKS FIRST — "may this member use this, and how?"
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The admin feature table (`frenzAiPlans.features`, lib/ai/credits/features.ts)
 * read for THIS member: their tier from their active AI plan (server-side,
 * `ai_subscriptions`), whether the tier may use the feature, how many of the
 * month's included generations are left, and whether wallet credits may pay.
 *
 * The quote calls it to DISPLAY; /start calls it again to DECIDE — and the
 * included generation itself is only ever taken by the atomic SQL function
 * after the claim (lib/ai/credits/included.ts).
 */
export interface FeatureContext {
  tier: AiTier;
  policy: AiFeaturePolicy;
  access: FeatureAccess;
  periodKey: string;
  includedPerMonth: number;
  includedUsed: number;
  includedRemaining: number;
  /** The browser's copy (lib/ai/credits/features.ts `publicFeatureAccess`). */
  view: ReturnType<typeof publicFeatureAccess>;
}

/**
 * `known.subscription` — a caller asking for several features at once (the
 * wallet summary) reads the subscription ONCE and passes it in. Omitted = read it.
 */
export async function featureContext(
  userId: string,
  featureId: string,
  plans: AiPlansConfig,
  now: Date = new Date(),
  known?: { subscription: AiSubscription | null },
): Promise<FeatureContext> {
  const policy = featurePolicy(plans.features, featureId);
  // the AI plan counts only while the offer is on and the subscription is active
  const sub = plans.enabled ? (known ? known.subscription : await getAiSubscription(userId).catch(() => null)) : null;
  const tier = tierOf(sub?.active && plans.plans[sub.plan]?.enabled ? sub.plan : null);
  const access = featureAccess(policy, tier);
  const periodKey = includedPeriodKey(now, plans.reset.timezone);
  const includedPerMonth = access.ok ? access.includedPerMonth : 0;
  const includedUsed = includedPerMonth > 0 ? await readIncludedUsed(userId, featureId, periodKey) : 0;
  const includedRemaining = Math.max(0, includedPerMonth - includedUsed);
  return { tier, policy, access, periodKey, includedPerMonth, includedUsed, includedRemaining, view: publicFeatureAccess(policy, tier, Math.min(includedUsed, includedPerMonth)) };
}

/** The refusal a tool returns when the table says no — the same words and facts from every tool. */
export function featureRefusal(ctx: FeatureContext): { code: "FEATURE_UNAVAILABLE" | "AI_PLAN_REQUIRED"; extra: Record<string, unknown> } | null {
  if (ctx.access.ok) return null;
  if (ctx.access.reason === "disabled") return { code: "FEATURE_UNAVAILABLE", extra: {} };
  return { code: "AI_PLAN_REQUIRED", extra: { reason: "tier", upgrade: ctx.access.upgrade, access: ctx.view } };
}

/** When neither an included generation nor plan credits cover it and the wallet is closed for this feature. */
export function payAsYouGoRefusal(ctx: FeatureContext): { code: "AI_PLAN_REQUIRED"; extra: Record<string, unknown> } | null {
  if (ctx.policy.payAsYouGo) return null;
  const upgrade = (["ai_pro", "ai_max"] as const).find((t) => t !== ctx.tier && ctx.policy.tiers[t]) ?? null;
  return { code: "AI_PLAN_REQUIRED", extra: { reason: "pay_as_you_go_off", upgrade, access: ctx.view } };
}
