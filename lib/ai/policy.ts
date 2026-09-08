import type { AiFeature } from "@/lib/ai/jobs";
import type { BillingPlan } from "@/lib/monetization/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI — what each plan gets, as DATA rather than as branches
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * One table. Every rule about allowances, rewarded ads and ceilings is a row in
 * it, and the authorization code reads the row rather than asking which plan it
 * is holding.
 *
 * ── 🔴 WHY THIS IS A TABLE AND NOT `if (plan === "free")` ────────────────────
 *
 * The owner, 2026-09-08, alongside the Part 5 brief:
 *
 *   "note the usage and pro plan here isnt the real one, part 10 has the plan
 *    and usage … there will be a new plan called max ai that has all pro and
 *    business features and also a 15 daily credits, while pro and business uses
 *    rewarded ads up to 3 rewarded ad each generation."
 *
 * So the rules in this file are KNOWN to be provisional — and they have already
 * moved once. Part 5 shipped "free gets 3 a day behind an ad"; a day later the
 * owner set it to 2 with no ad, because no rewarded ad is running yet. That
 * change was two fields on one row, which is the argument for this file making
 * itself. Part 10 moves them again: the paid plans start watching ads, a new
 * plan appears above them, and the allowance becomes credits.
 *
 * Written as branches, that would be a rewrite of every authorization path.
 * Written as a table, it is a diff to these rows: add `max_ai`, set
 * `requiresReward: true` and `rewardsPerJob: 3` on pro and business, done. The
 * flow that reserves usage, verifies rewards and starts jobs does not change at
 * all, because it never knew which plan it was serving.
 *
 * That is the whole reason `rewardsPerJob` exists today with the value 1: it is
 * not speculative generality, it is the field the owner has already told us
 * changes, and having it now is the difference between a data change and a
 * refactor.
 *
 * Pure and dependency-light, so the rules can be tested without a database.
 */

export interface AiPlanPolicy {
  /** Jobs admitted per business day. Always a real number — see `unlimited`. */
  dailyLimit: number;
  /**
   * True when `dailyLimit` is an ABUSE ceiling rather than a product cap.
   *
   * The difference is what the interface may say. "1 of 3 left today" is a fact
   * worth showing a free member; showing a Pro member "97 left today" would
   * invent a restriction they are not under and are not paying for.
   */
  unlimited: boolean;
  /**
   * Whether a verified rewarded-ad session is required before each job.
   *
   * ⚠️ Part 10 sets this true for `pro` and `business`. Nothing in the
   * authorization flow needs to change when it does.
   */
  requiresReward: boolean;
  /**
   * How many separate verified rewards one job costs.
   *
   * 1 today. The owner has said Part 10 raises this to 3 for the paid plans —
   * "up to 3 rewarded ad each generation" — which is why the authorization
   * layer counts rewards rather than checking for the presence of one.
   */
  rewardsPerJob: number;
  /** Jobs this member may have queued, processing or finalizing at once. */
  maxConcurrent: number;
}

/**
 * The rules, per plan.
 *
 * 🔴 Every plan is metered, including the paid ones, and that is deliberate.
 * The obvious shape is "free goes through the counter, Pro skips it" — and it
 * is where the bugs live: the moment one class of member takes a different code
 * path, that path stops being exercised, and the day a Pro session is stolen
 * there is nothing between it and an unbounded provider bill. Pro's number is
 * not a product limit; it is a ceiling no real person reaches.
 */
const POLICY: Record<BillingPlan, AiPlanPolicy> = {
  free: {
    /*
      ⚠️ TWO, and no ad (owner, 2026-09-08: "make the free users usage credit to
      be 2 now because there is no rewarded ad").

      Part 5 built the whole rewarded-ad path and it stays built — the tables,
      the atomic claim, the provider seam, all of it. What changed is the POLICY
      that decides whether it runs, which is the entire reason the rules live in
      a table. Turning ads back on for free members is `requiresReward: true`
      here and nothing else, and Part 10 turns them on for the paid plans the
      same way.

      This number is also admin-settable; see `applyConfiguredLimits`.
    */
    dailyLimit: 2,
    unlimited: false,
    requiresReward: false,
    rewardsPerJob: 0,
    // One at a time. A free member with three jobs in flight is either testing
    // us or automating us.
    maxConcurrent: 1,
  },
  pro: {
    // At ten minutes of video each, a hundred jobs is more footage than anyone
    // cleans by hand in a day. Not a promise, not reachable, not a product cap.
    dailyLimit: 100,
    unlimited: true,
    // ⚠️ Part 10 flips this to true with rewardsPerJob 3.
    requiresReward: false,
    rewardsPerJob: 0,
    maxConcurrent: 3,
  },
  business: {
    dailyLimit: 250,
    unlimited: true,
    requiresReward: false,
    rewardsPerJob: 0,
    maxConcurrent: 5,
  },
};

/** The policy for a plan. Never throws — an unknown plan is treated as free. */
export function policyFor(plan: BillingPlan): AiPlanPolicy {
  return POLICY[plan] ?? POLICY.free;
}

/**
 * The policy with an operator's configured numbers applied.
 *
 * 🔴 Only the FREE allowance is configurable, and only downward-safe: the value
 * arrives already clamped by `normalizeFreeCredits` (0-20). An admin field feeds
 * a daily allowance that costs real provider money, so it is bounded at the
 * source and bounded again on read.
 *
 * The paid ceilings are deliberately NOT settable. They are abuse limits, not
 * product knobs, and an operator raising one by mistake is how a stolen session
 * becomes an unbounded bill.
 *
 * Pure: the caller does the async settings read, so the rules stay testable.
 */
export function applyConfiguredLimits(
  policy: AiPlanPolicy,
  config: { freeDailyCredits?: number } = {},
): AiPlanPolicy {
  if (policy.unlimited) return policy;
  if (typeof config.freeDailyCredits !== "number" || !Number.isFinite(config.freeDailyCredits)) {
    return policy;
  }
  return { ...policy, dailyLimit: Math.max(0, Math.floor(config.freeDailyCredits)) };
}

/**
 * Whether a feature is offered to a plan at all.
 *
 * Separate from the policy above because "this plan cannot use this tool" and
 * "this plan must watch an ad first" are different answers that deserve
 * different sentences on screen. Today every signed-in plan may use AI Clean.
 */
export function featureOfferedTo(_plan: BillingPlan, _feature: AiFeature): boolean {
  return true;
}

/**
 * What the browser is allowed to know.
 *
 * 🔴 An allow-list, and deliberately NOT the policy object. Nothing about
 * ceilings, abuse thresholds or another plan's terms belongs in a response —
 * and none of these values are ever read back as authority. The server
 * re-resolves all of it on the next request; this exists so the interface can
 * say "1 of 3 left today" without guessing.
 */
export interface AiEntitlementView {
  plan: BillingPlan;
  /** True when the plan has no product cap. The interface hides counts then. */
  unlimited: boolean;
  /** null when unlimited — a number here would invent a restriction. */
  dailyLimit: number | null;
  usedToday: number;
  /** null when unlimited. */
  remainingToday: number | null;
  /** Whether a verified reward is needed before the next job. */
  rewardRequired: boolean;
  /** How many rewards that job costs. 0 when none are required. */
  rewardsPerJob: number;
  /** False when the allowance is spent — an ad cannot buy past the cap. */
  canStart: boolean;
}

export function entitlementView(input: {
  plan: BillingPlan;
  policy: AiPlanPolicy;
  usedToday: number;
}): AiEntitlementView {
  const { plan, policy, usedToday } = input;
  const remaining = Math.max(0, policy.dailyLimit - usedToday);

  return {
    plan,
    unlimited: policy.unlimited,
    dailyLimit: policy.unlimited ? null : policy.dailyLimit,
    usedToday,
    remainingToday: policy.unlimited ? null : remaining,
    /*
      🔴 No reward is required once the allowance is gone.

      This is the distinction the brief is most explicit about: the ad unlocks a
      REMAINING session, it does not create an extra one. Asking somebody to
      watch an ad that cannot buy them anything is the single worst thing this
      screen could do, so `rewardRequired` goes false the moment `canStart`
      does — and the interface shows the limit-reached state instead of a
      "Watch Ad" button.
    */
    rewardRequired: policy.requiresReward && remaining > 0,
    rewardsPerJob: policy.requiresReward && remaining > 0 ? policy.rewardsPerJob : 0,
    canStart: remaining > 0,
  };
}
