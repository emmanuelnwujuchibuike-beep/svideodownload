import type { AiFeature, AiFeatureDef } from "@/lib/ai/jobs";
import { entitlementView, featureOfferedTo, policyFor, type AiEntitlementView } from "@/lib/ai/policy";
import { getUserPlan } from "@/lib/monetization/plan";
import type { BillingPlan } from "@/lib/monetization/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI — what a member's plan entitles them to, resolved in one place
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-07 (Part 2): "Do NOT create a second independent subscription
 * system. If the existing Frenzsave project already has a server-side
 * subscription helper, reuse it."
 *
 * It does, and this file is a thin layer over it. `getUserPlan` already
 * resolves the `subscriptions` table, an active site-wide promo, and the rule
 * that a promo may lift a free member to Pro but may never downgrade a paying
 * one. Re-implementing any part of that here would mean two answers to "is this
 * person Pro", and the wrong one would eventually be the one that ran.
 *
 * ── 🔴 Pro is metered too, and that is deliberate ────────────────────────────
 *
 * The obvious shape is "free members go through the counter, Pro skips it". It
 * is also where the bugs live: the moment one class of member takes a different
 * code path, that path stops being tested, and the day a Pro account is
 * compromised there is nothing between it and an unbounded provider bill.
 *
 * So EVERY member is reserved against the same counter. Pro's ceiling is not a
 * product limit — it is an abuse ceiling, set far above what any real person
 * does in a day, and no Pro member will ever meet it by using the product.
 * "Unlimited subject to abuse/rate protection" is exactly what the owner asked
 * for; this is what that sentence looks like in code.
 */

export interface AiEntitlement {
  plan: BillingPlan;
  feature: AiFeature;
  /** Whether this plan may use this feature at all. */
  allowed: boolean;
  /**
   * Jobs admitted per UTC day. Always a real number — see the note above about
   * why Pro is metered rather than exempt.
   */
  dailyLimit: number;
  /**
   * True when the limit is an abuse ceiling rather than a product cap. The
   * difference matters to the interface: "3 left today" is a fact worth showing
   * a free member, and showing a Pro member "97 left today" would invent a
   * restriction they are not under.
   */
  unlimited: boolean;
  /** Jobs this member may have queued or processing at once. */
  maxConcurrent: number;
  /**
   * Whether a verified rewarded-ad session is required before each job.
   *
   * ⚠️ False for the paid plans in Part 5 and true for them in Part 10 — a row
   * change in lib/ai/policy.ts, not a change here.
   */
  requiresReward: boolean;
  /** How many verified rewards one job costs. 0 when none are required. */
  rewardsPerJob: number;
}

/*
  ⚠️ The per-plan numbers that used to be two hardcoded objects here now live in
  ONE declarative table: lib/ai/policy.ts.

  That move is the whole architectural point of Part 5. The owner has already
  said what Part 10 changes — a new `max_ai` plan with 15 daily credits, and
  `pro`/`business` moving to "up to 3 rewarded ads each generation" — and with
  the rules as data that is a diff to rows rather than a rewrite of every
  authorization path. Nothing below asks which plan it is serving.
*/

/**
 * The entitlement for one member and one feature.
 *
 * Takes the feature DEFINITION rather than its id so the caller has already
 * been through the registry — an entitlement for a feature that does not exist
 * is not a question worth being able to ask.
 */
export async function getUserAIEntitlement(
  userId: string,
  feature: AiFeatureDef,
): Promise<AiEntitlement> {
  // 🔴 The plan comes from the EXISTING subscription helper, never from a
  // request. `getUserPlan` already resolves the subscriptions table, an active
  // promo, and the rule that a promo may lift a free member but never downgrade
  // a paying one. A second answer to "is this person Pro" is a second thing to
  // be wrong.
  const plan = await getUserPlan(userId);
  const policy = policyFor(plan);

  return {
    plan,
    feature: feature.id,
    allowed: featureOfferedTo(plan, feature.id) && policy.dailyLimit > 0,
    dailyLimit: policy.dailyLimit,
    unlimited: policy.unlimited,
    maxConcurrent: policy.maxConcurrent,
    requiresReward: policy.requiresReward,
    rewardsPerJob: policy.rewardsPerJob,
  };
}

/**
 * The whole picture for one member: plan, policy and what they have spent.
 *
 * One call, so the entitlement endpoint and the start path cannot disagree
 * about the same member in the same second.
 */
export async function getAiEntitlementSnapshot(
  userId: string,
  feature: AiFeatureDef,
  usedToday: number,
): Promise<{ entitlement: AiEntitlement; view: AiEntitlementView }> {
  const entitlement = await getUserAIEntitlement(userId, feature);
  return {
    entitlement,
    view: entitlementView({
      plan: entitlement.plan,
      policy: policyFor(entitlement.plan),
      usedToday,
    }),
  };
}

/**
 * The allowance as a member should see it.
 *
 * A free member is told the truth about a real cap. A paid member is told they
 * are not capped, and the ceiling they will never meet is not mentioned —
 * quoting it would read as a limit and would be the only place in the product
 * that suggested Pro had one.
 */
export function usageForClient(
  entitlement: AiEntitlement,
  used: number,
): { plan: BillingPlan; unlimited: boolean; limit: number | null; used: number; remaining: number | null } {
  if (entitlement.unlimited) {
    return { plan: entitlement.plan, unlimited: true, limit: null, used, remaining: null };
  }
  return {
    plan: entitlement.plan,
    unlimited: false,
    limit: entitlement.dailyLimit,
    used,
    remaining: Math.max(0, entitlement.dailyLimit - used),
  };
}
