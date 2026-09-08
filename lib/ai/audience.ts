import type { BillingPlan } from "@/lib/monetization/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHO IS ASKING — the audience an AI allowance is resolved for
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-08 (the Video Text Remover access brief):
 *
 *   Guest 2/day · Free 2/day · Pro 5/day · Business 15/day · Max AI 30/day
 *
 * Five audiences, and `BillingPlan` only has three. The two extras are the
 * reason this type exists rather than the plan being used directly.
 *
 * ── 🔴 WHY THIS IS NOT A CHANGE TO `BillingPlan` ─────────────────────────────
 *
 * The brief is emphatic that nothing existing may break — "preserve existing
 * subscription/billing logic". `BillingPlan` is read by the download limiter,
 * the Paystack sync, the admin plan-override form and `PlanLimits`. Widening it
 * would make every one of those handle two new cases, and "guest" is not a
 * billing plan at all: nobody subscribes to being signed out.
 *
 * So the AI layer keeps its own vocabulary. `BillingPlan` still answers "what
 * is this person paying for"; `AiAudience` answers "which row of the AI policy
 * table applies", which is a superset and a different question.
 *
 * ── ⚠️ `max_ai` RESOLVES BUT NOTHING CREATES IT YET ──────────────────────────
 *
 * There is no Paystack plan, no pricing row and no upgrade path for `max_ai`
 * today — the owner has said Part 10 brings it. What exists now is the ROW in
 * the policy table and the resolution below, so the day a `max_ai` subscription
 * appears it simply works, with no code change and no migration.
 *
 * `getUserPlan` already returns whatever string the `subscriptions` row holds
 * (its `as BillingPlan` cast is a lie the compiler cannot catch), so a `max_ai`
 * value flows through it untouched. `audienceFromPlan` is where that string is
 * checked against a real list instead of trusted — which is also what stops a
 * typo'd or hand-edited plan value silently granting an unknown allowance.
 */
export type AiAudience = "guest" | "free" | "pro" | "business" | "max_ai";

/** Every audience, in ascending order of what it is allowed to do. */
export const AI_AUDIENCES: readonly AiAudience[] = ["guest", "free", "pro", "business", "max_ai"];

const KNOWN = new Set<string>(AI_AUDIENCES);

export function isAiAudience(value: unknown): value is AiAudience {
  return typeof value === "string" && KNOWN.has(value);
}

/**
 * The audience for a signed-in member's resolved plan.
 *
 * 🔴 Anything unrecognised becomes `free`, never the highest tier. A plan
 * string this build has never heard of is either a typo, a hand-edited row or a
 * tier from a newer deploy — and the safe reading of all three is the smallest
 * allowance, not the largest. Failing generous here would mean an unknown
 * string in one database column granting 30 provider runs a day.
 */
export function audienceFromPlan(plan: BillingPlan | string | null | undefined): AiAudience {
  if (!plan) return "free";
  // "guest" is not reachable from a plan — a signed-in member is never a guest,
  // whatever their subscriptions row says.
  if (plan === "guest") return "free";
  return isAiAudience(plan) ? plan : "free";
}

/** True for the audiences whose allowance an operator may configure. */
export function isConfigurableAudience(audience: AiAudience): boolean {
  return audience === "guest" || audience === "free";
}
