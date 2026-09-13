import { isConfigurableAudience, type AiAudience } from "@/lib/ai/audience";
import {
  aiCleanBriaOffered,
  aiCleanGpuOffered,
  hardwareFor,
  modelTierFor,
  type AiModelTier,
} from "@/lib/ai/hardware";
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
  /**
   * ── 🔴 A TOOL WITH NO FREE ALLOWANCE AT ALL ──────────────────────────────
   *
   * True for Character Replace (2026-09-13): every run is paid from the
   * member's balance, so `dailyLimit` is 0 for every audience and that zero
   * does NOT mean "not offered". The entitlement reads this to say "allowed,
   * funded at checkout" where it would otherwise say "no allowance today",
   * and the allowance bar draws nothing for it. `applyConfiguredLimits`
   * leaves a paid-only row alone — the operator's free-credit fields are
   * about free allowances, and this tool has none to configure.
   */
  paidOnly?: boolean;
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
/*
  ── 🔴 AI CLEAN'S TABLE IS GONE WITH THE TOOL (owner, 2026-09-13) ──────────

  "Just remove the AI Clean features and leave only the new character
  replace." The table that stood here carried the free/guest 2-a-day rows,
  the paid tiers' caps and the long history of the rewarded-ad gate. Two of
  its rules survive as facts about the platform rather than about a tool:

    · NO AD FOR ANYONE, EVER (standing rule §6). `requiresReward` is false on
      every row of every table, and policy.test.ts asserts it. The reward
      module and route were deleted the same day.
    · EVERY AUDIENCE IS METERED, including the paid ones, because a class of
      member on a different code path is a path nothing tests.
*/

/**
 * Character Replace — the Wan 2.2 tool.
 *
 * ── 🔴 FUNDED FROM THE BALANCE, NEVER FROM A FREE ALLOWANCE ─────────────────
 *
 * The owner's flow is "show the exact price → confirm payment from balance →
 * start". One run is minutes of GPU time on a paid provider; a free allowance
 * here would be the owner buying every curious tap. So `dailyLimit` is 0 on
 * every row and `paidOnly` says that zero is the design, not a switch-off.
 *
 * The daily ceiling that still applies is `maxConcurrent` — how many jobs one
 * member may have in flight — and an abuse ceiling on paid runs is Part 2's
 * funding step (it charges per job; a stolen session can only spend what the
 * balance holds).
 *
 * `offered: false` for a guest: the whole AI surface is signed-in only since
 * 2026-09-09 and `resolveAiSubject` refuses a guest before this row is read,
 * but the row must still be sane on its own.
 */
const CHARACTER_REPLACE: Record<AiAudience, AiPlanPolicy> = {
  guest: {
    dailyLimit: 0,
    unlimited: false,
    requiresReward: false,
    rewardsPerJob: 0,
    rewardScope: "job",
    maxConcurrent: 1,
    offered: false,
    paidOnly: true,
  },
  free: {
    dailyLimit: 0,
    unlimited: false,
    requiresReward: false,
    rewardsPerJob: 0,
    rewardScope: "job",
    maxConcurrent: 1,
    paidOnly: true,
  },
  pro: {
    dailyLimit: 0,
    unlimited: false,
    requiresReward: false,
    rewardsPerJob: 0,
    rewardScope: "day",
    maxConcurrent: 2,
    paidOnly: true,
  },
  business: {
    dailyLimit: 0,
    unlimited: false,
    requiresReward: false,
    rewardsPerJob: 0,
    rewardScope: "day",
    maxConcurrent: 3,
    paidOnly: true,
  },
  max_ai: {
    dailyLimit: 0,
    unlimited: false,
    requiresReward: false,
    rewardsPerJob: 0,
    rewardScope: "day",
    maxConcurrent: 3,
    paidOnly: true,
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
  ai_character_replace: CHARACTER_REPLACE,
};

/** The policy for one audience and one feature. Never throws. */
export function policyFor(audience: AiAudience, feature: AiFeature): AiPlanPolicy {
  const table = FEATURE_POLICY[feature] ?? DEFAULT_BY_AUDIENCE;
  return table[audience] ?? DEFAULT_BY_AUDIENCE[audience] ?? DEFAULT_BY_AUDIENCE.free;
}

/**
 * The policy with an operator's configured numbers applied.
 *
 * ── 🔴 PAID CAPS ARE CONFIGURABLE NOW TOO (owner, 2026-09-09) ───────────────
 *
 * "pro and business cap should be able to change in admin dashboard, if is not
 * set yet set it up."
 *
 * This function previously refused that outright, with the argument that "an
 * operator lowering Pro to 1/day by mistake would be a silent breach of a
 * subscription, and raising Business to 500 would be a provider bill nobody
 * approved". Both of those remain true — they are just not arguments about WHO
 * decides, which is the question the owner has answered. They are arguments
 * about BOUNDS, and that is where they now live:
 * `normalizePaidCredits` in lib/landing/settings.ts clamps every saved value
 * between a floor that protects the subscription and a ceiling that protects
 * the bill, and the admin route re-applies the same bounds on the way in.
 *
 * 🔴 THE MISSING-VALUE CASE IS THE ONE THAT MATTERS. An absent or non-finite
 * config leaves the shipped policy untouched, so a settings row that has never
 * been saved — or a read that failed — gives a paying member exactly what the
 * code says they get. It must never fall through to zero.
 *
 * `guest` remains untouched by the paid branch: it has no cap to raise.
 *
 * Pure: the caller does the async settings read, so the rules stay testable.
 */
export function applyConfiguredLimits(
  policy: AiPlanPolicy,
  audience: AiAudience,
  config: {
    freeDailyCredits?: number;
    freeEnabled?: boolean;
    proDailyCredits?: number;
    businessDailyCredits?: number;
    /**
     * The tool's own on/off switch (Character Replace → enabled). Read only
     * for a paid-only row, where there is no free-credit field to carry the
     * "off" meaning; `false` turns the row to `offered: false`.
     */
    toolEnabled?: boolean;
  } = {},
): AiPlanPolicy {
  /*
    The paid branch, first and separate. `isConfigurableAudience` gates the
    free/guest fields below and answers false for these, so folding them into
    the same branch would have made the gate wrong for one of its two callers.
  */
  /*
    🔴 A PAID-ONLY TOOL HAS NO FREE ALLOWANCE TO CONFIGURE. The operator's
    daily-credit fields describe free runs, and applying "2 free a day" to a
    tool whose every run costs the owner GPU money would be the exact bill the
    zero in its table exists to prevent. The row is returned untouched; the
    on/off switch for the tool is its own setting (Character Replace → enabled),
    applied by the entitlement, not here.
  */
  if (policy.paidOnly) {
    return config.toolEnabled === false ? { ...policy, offered: false } : policy;
  }

  if (audience === "pro" || audience === "business") {
    const configured = audience === "pro" ? config.proDailyCredits : config.businessDailyCredits;
    if (typeof configured !== "number" || !Number.isFinite(configured) || configured <= 0) {
      return policy;
    }
    return { ...policy, dailyLimit: Math.floor(configured) };
  }

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
  /** See AiPlanPolicy.paidOnly. The interface hides the allowance bar on it. */
  paidOnly: boolean;
  /** False when the allowance is spent; always true for a paid-only tool that is offered. */
  canStart: boolean;
  /**
   * Whether THIS subject already runs on the faster hardware.
   *
   * 🔴 Present so the interface can stop claiming a speed tier that does not
   * exist. It is false for everybody until a GPU model is configured, and the
   * upsell copy is gated on it — see lib/ai/hardware.ts.
   */
  gpuAccelerated: boolean;
  /**
   * Whether a GPU model exists on this deployment AT ALL.
   *
   * 🔴 Distinct from `gpuAccelerated`, and the difference is what makes the
   * upsell honest: a FREE member is never accelerated, so their own flag is
   * always false — but they are exactly who the "faster on Pro" line is for.
   * That line is gated on this one, so it appears when the capability is real
   * and stays silent when it is not.
   */
  gpuOffered: boolean;
  /**
   * Whether the BRIA model (Max AI) exists on this deployment at all.
   *
   * 🔴 Gates the "Max AI" label the same way `gpuOffered` gates the speed
   * claim. The plan can be sold before the model ships; the CLAIM about what it
   * does may not be.
   */
  briaOffered: boolean;
  /** The model tier this subject actually runs on today. */
  modelTier: AiModelTier;
}

export function entitlementView(input: {
  audience: AiAudience;
  policy: AiPlanPolicy;
  usedToday: number;
  /** Whether a day-scoped reward has already been granted for today. */
  dayUnlocked?: boolean;
  /** True only when a GPU model is actually configured on this deployment. */
  gpuConfigured?: boolean;
  /** True only when the BRIA model is actually configured on this deployment. */
  briaConfigured?: boolean;
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
  /*
    A paid-only tool is spendable whenever it is offered: there is no counter
    to run out of, and whether the BALANCE covers a given job is decided at
    checkout by the funding step against the server's own price — never here.
  */
  const paidOnly = policy.paidOnly === true;
  const spendable = offered && (paidOnly || remaining > 0);
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
    paidOnly,
    canStart: spendable,
    // Entitlement AND capability. A paid tier is entitled whether or not a GPU
    // model is deployed; this says what is actually happening.
    gpuAccelerated: hardwareFor(audience, { gpuConfigured: input.gpuConfigured === true }) === "gpu",
    gpuOffered: aiCleanGpuOffered({ gpuConfigured: input.gpuConfigured === true }),
    briaOffered: aiCleanBriaOffered({ briaConfigured: input.briaConfigured === true }),
    modelTier: modelTierFor(audience, {
      gpuConfigured: input.gpuConfigured === true,
      briaConfigured: input.briaConfigured === true,
    }),
  };
}
