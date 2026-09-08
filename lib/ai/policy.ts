import { isConfigurableAudience, type AiAudience } from "@/lib/ai/audience";
import type { AiFeature } from "@/lib/ai/jobs";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI — what each audience gets, per FEATURE, as data rather than branches
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * One table per tool. Every rule about allowances, rewarded ads and ceilings is
 * a row in it, and the authorization code reads the row rather than asking
 * which plan or which feature it is holding.
 *
 * ── 🔴 WHY IT IS KEYED BY FEATURE NOW (owner, 2026-09-08) ───────────────────
 *
 *   "Create/use a dedicated entitlement namespace specifically for this
 *    feature… Do NOT create a global AI quota that affects every AI feature.
 *    This is critical because more AI tools will be added later. Adding Video
 *    Text Remover limits must NOT accidentally limit those future tools."
 *
 * Part 5's table was keyed by plan alone, so every AI tool would have shared
 * one allowance — and the day a cheap caption rewriter shipped, it would have
 * spent the same two runs a day as a job that costs real GPU minutes. Now
 * `ai_clean` has its OWN row set and everything else falls to
 * `DEFAULT_BY_AUDIENCE`, so a new tool inherits a sane starting point and none
 * of AI Clean's economics.
 *
 * The storage layer already agreed with this: `ai_usage_daily` has been unique
 * on `(subject, usage_date, feature)` since migration 0141, so the counters
 * were never shared. This makes the RULES match the counters.
 *
 * ── The numbers, and where they came from ────────────────────────────────────
 *
 *   Guest     2/day   an ad per generation
 *   Free      2/day   an ad per generation
 *   Pro       5/day   ONE ad unlocks the day
 *   Business 15/day   ONE ad unlocks the day
 *   Max AI   30/day   ONE ad unlocks the day
 *
 * Straight from the owner's brief. Note that NOTHING is unlimited any more:
 * Part 5 gave the paid plans an abuse ceiling they were never shown, and the
 * brief replaces that with a real, displayed cap ("3 / 5 used today"). Every
 * audience is now metered the same way and told the same truth.
 *
 * ── 🔴 `rewardScope` is the new idea, and it is why one ad can buy a day ─────
 *
 *   "Do NOT require a separate reward ad for every individual video if the
 *    existing reward-ad system supports unlocking the daily allowance/session."
 *
 * `job`  — the reward is spent on one generation, single-use (guest, free).
 * `day`  — the reward unlocks the whole day for that feature (paid plans).
 *
 * Two different mechanisms behind one field: a job-scoped reward is claimed
 * atomically at the moment of use, a day-scoped one stamps today's usage row.
 * The authorization flow asks the field and never knows which plan it is
 * serving — which is the entire reason this file exists.
 *
 * Pure and dependency-light, so the rules can be tested without a database.
 */

/** Whether a reward buys one generation or the whole day. */
export type AiRewardScope = "job" | "day";

export interface AiPlanPolicy {
  /** Jobs admitted per UTC day for THIS feature. */
  dailyLimit: number;
  /**
   * True when `dailyLimit` is an abuse ceiling rather than a product cap.
   *
   * ⚠️ False for every AI Clean row now — the owner's brief gives each tier a
   * real number that is meant to be SHOWN. The field survives because a future
   * tool may genuinely be uncapped for paid plans, and because the interface
   * still needs to be able to ask.
   */
  unlimited: boolean;
  /** Whether a verified rewarded-ad session is required. */
  requiresReward: boolean;
  /** How many separate rewards one unlock costs. */
  rewardsPerJob: number;
  /** Whether that unlock covers one job or the rest of the day. */
  rewardScope: AiRewardScope;
  /** Jobs this audience may have queued, processing or finalizing at once. */
  maxConcurrent: number;
  /**
   * Whether this audience is offered the feature at all right now.
   *
   * False means "not for you", which is a different sentence from "you have
   * used today's allowance". Defaults true; only an operator switch turns it
   * off.
   */
  offered?: boolean;
}

/**
 * AI Clean — the Video Text Remover.
 *
 * 🔴 Every audience is metered, including the paid ones, and that is
 * deliberate. The obvious shape is "free goes through the counter, Pro skips
 * it" — and it is where the bugs live: the moment one class of member takes a
 * different code path, that path stops being exercised, and the day a Pro
 * session is stolen there is nothing between it and an unbounded provider bill.
 */
const AI_CLEAN: Record<AiAudience, AiPlanPolicy> = {
  /*
    🔴 A GUEST CAN ACTUALLY RUN THIS. That is the point of the row.

    "The 2/day guest allowance must work without requiring account creation or
    login… Do not force users to sign up before they can try the AI."

    So this is a real allowance backed by a real server-side counter, not a
    teaser. What makes it safe is that the subject is a server-issued signed
    identifier with an IP ceiling behind it (lib/ai/subject.ts), never a number
    the browser keeps.
  */
  guest: {
    dailyLimit: 2,
    unlimited: false,
    requiresReward: true,
    rewardsPerJob: 1,
    // An ad per generation: the guest tier costs us provider money and returns
    // no subscription, so the ad is the exchange.
    rewardScope: "job",
    // One at a time. A signed-out visitor with two jobs in flight is automating
    // us, not using us.
    maxConcurrent: 1,
  },
  free: {
    // Deliberately IDENTICAL to guest. Signing up must not hand somebody a
    // second allowance for the same day — see the reconciliation rule in
    // lib/ai/subject.ts. Making the numbers differ would create exactly the
    // "guest quota + free quota" bypass the brief calls out.
    dailyLimit: 2,
    unlimited: false,
    requiresReward: true,
    rewardsPerJob: 1,
    rewardScope: "job",
    maxConcurrent: 1,
  },
  pro: {
    dailyLimit: 5,
    unlimited: false,
    requiresReward: true,
    rewardsPerJob: 1,
    // ONE ad for the day, not one per video. A paying member asked to watch an
    // ad before every single generation would reasonably feel they were paying
    // for nothing.
    rewardScope: "day",
    maxConcurrent: 2,
  },
  business: {
    dailyLimit: 15,
    unlimited: false,
    requiresReward: true,
    rewardsPerJob: 1,
    rewardScope: "day",
    maxConcurrent: 3,
  },
  max_ai: {
    /*
      ⚠️ 30 is a CEILING ON THIS FEATURE, and it is not the same thing as Max
      AI's 15 daily AI credits.

      "The existing 15 AI credits must NEVER allow Max AI to exceed 30 Video
      Text Remover generations per day."

      The two live in different systems and cannot reach each other: credits are
      a Redis counter keyed `ai:u:<id>` (lib/ai/quota.ts), this is a Postgres
      row in `ai_usage_daily` keyed by feature. Spending one does not move the
      other in either direction — asserted by a test, because "they happen not
      to be connected" is a property that decays silently.
    */
    dailyLimit: 30,
    unlimited: false,
    requiresReward: true,
    rewardsPerJob: 1,
    rewardScope: "day",
    maxConcurrent: 3,
  },
};

/**
 * The starting point for a tool that has no table of its own yet.
 *
 * 🔴 Deliberately conservative, and deliberately NOT a copy of AI Clean's
 * numbers. A future tool inheriting "30 a day for Max AI" would be a promise
 * nobody made about work nobody has costed. Whoever ships the next tool gives
 * it a real row; until then it is offered narrowly rather than generously.
 */
const DEFAULT_BY_AUDIENCE: Record<AiAudience, AiPlanPolicy> = {
  guest: { dailyLimit: 0, unlimited: false, requiresReward: false, rewardsPerJob: 0, rewardScope: "job", maxConcurrent: 1, offered: false },
  free: { dailyLimit: 2, unlimited: false, requiresReward: false, rewardsPerJob: 0, rewardScope: "job", maxConcurrent: 1 },
  pro: { dailyLimit: 10, unlimited: false, requiresReward: false, rewardsPerJob: 0, rewardScope: "day", maxConcurrent: 2 },
  business: { dailyLimit: 25, unlimited: false, requiresReward: false, rewardsPerJob: 0, rewardScope: "day", maxConcurrent: 3 },
  max_ai: { dailyLimit: 40, unlimited: false, requiresReward: false, rewardsPerJob: 0, rewardScope: "day", maxConcurrent: 3 },
};

/**
 * The per-feature tables.
 *
 * A feature absent from here uses `DEFAULT_BY_AUDIENCE`, which is what makes
 * "adding Video Text Remover limits must not limit future tools" true by
 * construction rather than by remembering.
 */
const FEATURE_POLICY: Partial<Record<AiFeature, Record<AiAudience, AiPlanPolicy>>> = {
  ai_clean: AI_CLEAN,
};

/** The policy for one audience and one feature. Never throws. */
export function policyFor(audience: AiAudience, feature: AiFeature): AiPlanPolicy {
  const table = FEATURE_POLICY[feature] ?? DEFAULT_BY_AUDIENCE;
  return table[audience] ?? DEFAULT_BY_AUDIENCE[audience] ?? DEFAULT_BY_AUDIENCE.free;
}

/**
 * The policy with an operator's configured numbers applied.
 *
 * 🔴 Only GUEST and FREE allowances are configurable. The paid numbers are what
 * somebody is paying for — an operator lowering Pro to 1/day by mistake would
 * be a silent breach of a subscription, and raising Business to 500 would be a
 * provider bill nobody approved. `isConfigurableAudience` is the gate, and a
 * test pins that paid rows come back untouched.
 *
 * Pure: the caller does the async settings read, so the rules stay testable.
 */
export function applyConfiguredLimits(
  policy: AiPlanPolicy,
  audience: AiAudience,
  config: { freeDailyCredits?: number; freeEnabled?: boolean } = {},
): AiPlanPolicy {
  if (!isConfigurableAudience(audience)) return policy;

  /*
    The switch beats the number. An operator who has turned the free tier off
    means off, whatever the credit field happens to say — and `offered: false`
    is what lets the interface say "not available on your plan" instead of the
    nonsense sentence "0 of 0 left today".
  */
  if (config.freeEnabled === false) {
    return { ...policy, dailyLimit: 0, offered: false, requiresReward: false, rewardsPerJob: 0 };
  }

  if (typeof config.freeDailyCredits !== "number" || !Number.isFinite(config.freeDailyCredits)) {
    return policy;
  }
  return { ...policy, dailyLimit: Math.max(0, Math.floor(config.freeDailyCredits)) };
}

/**
 * Whether a feature is offered to an audience at all.
 *
 * Separate from the numbers because "this tool is not for you" and "you must
 * watch an ad first" are different answers deserving different sentences. A
 * `dailyLimit` of 0 with `offered: false` is how a table row says the first.
 */
export function featureOfferedTo(audience: AiAudience, feature: AiFeature): boolean {
  return policyFor(audience, feature).offered !== false;
}

/**
 * What the browser is allowed to know.
 *
 * 🔴 An allow-list, and deliberately NOT the policy object. Nothing about
 * ceilings, abuse thresholds or another plan's terms belongs in a response —
 * and none of these values are ever read back as authority. The server
 * re-resolves all of it on the next request; this exists so the interface can
 * say "3 of 5 used today" without guessing.
 */
export interface AiEntitlementView {
  audience: AiAudience;
  /** False when the operator has switched this audience's access off. */
  offered: boolean;
  /** True when the plan has no product cap. The interface hides counts then. */
  unlimited: boolean;
  /** null when unlimited — a number here would invent a restriction. */
  dailyLimit: number | null;
  usedToday: number;
  /** null when unlimited. */
  remainingToday: number | null;
  /** Whether a reward is needed before the next job. */
  rewardRequired: boolean;
  /** How many rewards that unlock costs. 0 when none are required. */
  rewardsPerJob: number;
  /** Whether that reward buys one job or the rest of today. */
  rewardScope: AiRewardScope;
  /** True once a day-scoped reward has already unlocked today. */
  rewardUnlocked: boolean;
  /** False when the allowance is spent — an ad cannot buy past the cap. */
  canStart: boolean;
}

export function entitlementView(input: {
  audience: AiAudience;
  policy: AiPlanPolicy;
  usedToday: number;
  /** Whether a day-scoped reward has already been granted for today. */
  dayUnlocked?: boolean;
}): AiEntitlementView {
  const { audience, policy, usedToday } = input;
  const remaining = Math.max(0, policy.dailyLimit - usedToday);
  const offered = policy.offered !== false;
  const dayUnlocked = input.dayUnlocked === true;

  /*
    🔴 NO REWARD IS EVER ASKED FOR ONCE THE ALLOWANCE IS GONE.

    The ad unlocks a REMAINING generation; it does not create an extra one.
    Asking somebody to watch an ad that cannot buy them anything is the single
    worst thing this screen could do, so `rewardRequired` goes false the moment
    `canStart` does — and the interface shows the limit-reached state instead of
    a "Watch Ad" button.

    A day-scoped reward that has already been granted is likewise not asked for
    again, which is what stops SPA navigation or a second tab re-triggering an
    ad the member already watched.
  */
  const spendable = offered && remaining > 0;
  const owesReward = spendable && policy.requiresReward && !(policy.rewardScope === "day" && dayUnlocked);

  return {
    audience,
    offered,
    unlimited: policy.unlimited,
    dailyLimit: policy.unlimited ? null : policy.dailyLimit,
    usedToday,
    remainingToday: policy.unlimited ? null : remaining,
    rewardRequired: owesReward,
    rewardsPerJob: owesReward ? policy.rewardsPerJob : 0,
    rewardScope: policy.rewardScope,
    rewardUnlocked: policy.rewardScope === "day" && dayUnlocked,
    canStart: spendable,
  };
}
