import { audienceFromPlan, type AiAudience } from "@/lib/ai/audience";
import type { AiFeatureDef } from "@/lib/ai/jobs";
import {
  applyConfiguredLimits,
  entitlementView,
  policyFor,
  type AiEntitlementView,
  type AiPlanPolicy,
  type AiRewardScope,
} from "@/lib/ai/policy";
import type { AiSubject } from "@/lib/ai/subject";
import { AI_GUEST_IP_DAILY_CEILING } from "@/lib/ai/subject";
import { getLandingSettings } from "@/lib/landing/settings";
import { getUserPlan } from "@/lib/monetization/plan";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI — what a subject may do, resolved in exactly one place
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-07 (Part 2): "Do NOT create a second independent subscription
 * system. If the existing Frenzsave project already has a server-side
 * subscription helper, reuse it."
 *
 * It does, and this is a thin layer over it. `getUserPlan` already resolves the
 * `subscriptions` table, an active site-wide promo, and the rule that a promo
 * may lift a free member to Pro but never downgrade a paying one.
 * Re-implementing any of that would mean two answers to "is this person Pro",
 * and the wrong one would eventually be the one that ran.
 *
 * ── 🔴 A GUEST NEVER TOUCHES THE SUBSCRIPTION SYSTEM ────────────────────────
 *
 * There is no account to look up, so there is no lookup. `audience` is decided
 * from the subject KIND before any plan query happens, which also means the
 * guest path costs zero database reads for entitlement — it matters, because
 * that path now runs for every anonymous visitor who opens the page.
 *
 * ── Every audience is metered, including the paid ones ──────────────────────
 *
 * The obvious shape is "free members go through the counter, Pro skips it". It
 * is also where the bugs live: the moment one class of member takes a different
 * code path, that path stops being tested, and the day a Pro account is
 * compromised there is nothing between it and an unbounded provider bill.
 */

export interface AiEntitlement {
  audience: AiAudience;
  feature: AiFeatureDef["id"];
  /** Whether this audience may use this feature at all. */
  allowed: boolean;
  /** Jobs admitted per UTC day for this feature. */
  dailyLimit: number;
  unlimited: boolean;
  /** Jobs this subject may have in flight at once. */
  maxConcurrent: number;
  /** Whether a rewarded-ad session is required. */
  requiresReward: boolean;
  /** How many rewards one unlock costs. */
  rewardsPerJob: number;
  /** Whether that unlock covers one job or the rest of today. */
  rewardScope: AiRewardScope;
  /**
   * The per-address ceiling to apply alongside this subject's own allowance.
   *
   * Null for a signed-in member: they are already identified by something
   * stronger than an address, and metering an office or a campus as one
   * account would be absurd. Only guests carry it — see lib/ai/subject.ts for
   * why it is a ceiling rather than a quota.
   */
  ipCeiling: number | null;
}

/** The entitlement for one subject and one feature. */
export async function getAiEntitlement(
  subject: AiSubject,
  feature: AiFeatureDef,
): Promise<AiEntitlement> {
  const audience: AiAudience =
    subject.kind === "guest"
      ? "guest"
      : // 🔴 The plan comes from the EXISTING subscription helper, never from a
        // request. A second answer to "is this person Pro" is a second thing to
        // be wrong.
        audienceFromPlan(await getUserPlan(subject.userId));

  /*
    The guest and free allowances are operator settings (owner, 2026-09-08).
    Read on the SERVER, applied here, and enforced by the same atomic
    reservation as before — the number moving does not move where the authority
    lives. Paid rows are untouched by config; see `applyConfiguredLimits`.
  */
  const settings = await getLandingSettings();
  const policy = applyConfiguredLimits(policyFor(audience, feature.id), audience, {
    freeDailyCredits: settings.frenzAiFreeDailyCredits,
    freeEnabled: settings.frenzAiFreeEnabled,
  });

  return {
    audience,
    feature: feature.id,
    allowed: policy.offered !== false && policy.dailyLimit > 0,
    dailyLimit: policy.dailyLimit,
    unlimited: policy.unlimited,
    maxConcurrent: policy.maxConcurrent,
    requiresReward: policy.requiresReward,
    rewardsPerJob: policy.rewardsPerJob,
    rewardScope: policy.rewardScope,
    ipCeiling: subject.kind === "guest" ? AI_GUEST_IP_DAILY_CEILING : null,
  };
}

/**
 * The whole picture for one subject: audience, policy, and what they have spent.
 *
 * One call, so the entitlement endpoint and the start path cannot disagree
 * about the same subject in the same second.
 */
export async function getAiEntitlementSnapshot(
  subject: AiSubject,
  feature: AiFeatureDef,
  usage: { usedToday: number; dayUnlocked: boolean },
): Promise<{ entitlement: AiEntitlement; view: AiEntitlementView }> {
  const entitlement = await getAiEntitlement(subject, feature);
  const policy: AiPlanPolicy = {
    dailyLimit: entitlement.dailyLimit,
    unlimited: entitlement.unlimited,
    requiresReward: entitlement.requiresReward,
    rewardsPerJob: entitlement.rewardsPerJob,
    rewardScope: entitlement.rewardScope,
    maxConcurrent: entitlement.maxConcurrent,
    // The entitlement already carries the configured numbers; rebuilding the
    // policy from scratch here would quietly ignore them.
    offered: entitlement.allowed,
  };

  return {
    entitlement,
    view: entitlementView({
      audience: entitlement.audience,
      policy,
      usedToday: usage.usedToday,
      dayUnlocked: usage.dayUnlocked,
    }),
  };
}

/**
 * The allowance as a member should see it.
 *
 * Kept because the job routes return it on a refusal, so the interface can
 * update its counter from the same response that told it no.
 */
export function usageForClient(
  entitlement: AiEntitlement,
  used: number,
): { plan: AiAudience; unlimited: boolean; limit: number | null; used: number; remaining: number | null } {
  if (entitlement.unlimited) {
    return { plan: entitlement.audience, unlimited: true, limit: null, used, remaining: null };
  }
  return {
    plan: entitlement.audience,
    unlimited: false,
    limit: entitlement.dailyLimit,
    used,
    remaining: Math.max(0, entitlement.dailyLimit - used),
  };
}
