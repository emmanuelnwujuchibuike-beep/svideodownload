import "server-only";

import type { AiPlanId, AiPlansConfig } from "@/lib/ai/credits/config";
import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import { SITE_URL } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A NEW AI PLAN IS CELEBRATED ONCE — push + in-app, linking to the celebration
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-10-07: "when they subscribe for pro, they should receive a
 * subscription celebration and an optional survey around the plans features."
 *
 * Every activation path calls this (the Paystack webhook, the Paystack
 * verify-on-return, the Bachs webhook and return). The claim is a conditional
 * update on the subscription row (0190 `welcomed_plan`), so whichever path
 * lands first sends it and the rest do nothing — and a renewal of the same
 * plan is never welcomed twice. The notification opens the credits page with
 * `?plan_welcome=1`, which shows the celebration and the optional survey.
 *
 * Never on the money path: callers run it in `after()`, and everything here
 * catches and logs.
 */
export const PLAN_WELCOME_PARAM = "plan_welcome";

export async function claimPlanWelcome(userId: string, plan: AiPlanId): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("ai_subscriptions")
    .update({ welcomed_plan: plan, welcomed_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("plan", plan)
    .in("status", ["active", "trialing"])
    .or(`welcomed_plan.is.null,welcomed_plan.neq.${plan}`)
    .select("user_id");
  if (error) {
    // before 0190 the column does not exist — say nothing rather than risk saying it twice
    console.error("[ai/plans] welcome claim failed", { userId, plan, message: error.message });
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/**
 * The Frenzsave plans (Pro / Business — the `subscriptions` row) get the same
 * welcome (owner 2026-10-07: "on all plans and not just AI plans"), claimed the
 * same way on THAT row and opening the account page's celebration.
 */
export async function welcomeSitePlan(userId: string, plan: "pro" | "business"): Promise<void> {
  try {
    const { data, error } = await createAdminClient()
      .from("subscriptions")
      .update({ welcomed_plan: plan, welcomed_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("plan", plan)
      .in("status", ["active", "trialing"])
      .or(`welcomed_plan.is.null,welcomed_plan.neq.${plan}`)
      .select("user_id");
    if (error) {
      console.error("[plans] site welcome claim failed", { userId, plan, message: error.message });
      return;
    }
    if (!data?.length) return;
    const label = plan === "business" ? "Frenzsave Business" : "Frenzsave Pro";
    await sendSmartPush(
      userId,
      {
        title: `🎉 Welcome to ${label}`,
        body: "Your plan is active — no ads on downloads, bigger batches and more storage. Tap to see everything that's included.",
        url: `${SITE_URL}/account?${PLAN_WELCOME_PARAM}=1`,
        genericBody: "Your Frenzsave plan is active.",
        tag: `site-plan-welcome-${plan}`,
      },
      "high",
      "premium",
      { type: "subscription_activated" },
    );
    console.info("[plans] site plan welcomed", { userId, plan });
  } catch (e) {
    console.error("[plans] site welcome failed", { userId, plan, error: String(e).slice(0, 200) });
  }
}

export async function welcomeAiPlan(userId: string, plan: AiPlanId, config: AiPlansConfig): Promise<void> {
  try {
    if (!(await claimPlanWelcome(userId, plan))) return;
    const p = config.plans[plan];
    await sendSmartPush(
      userId,
      {
        title: `🎉 Welcome to ${p.label}`,
        body: `Your plan is active — ${p.dailyCredits} credits a day, ${p.weeklyCredits} a week, on every Frenz AI tool. Tap to see what's included.`,
        url: `${SITE_URL}/ai/usage?${PLAN_WELCOME_PARAM}=1`,
        genericBody: "Your Frenz AI plan is active.",
        tag: `ai-plan-welcome-${plan}`,
      },
      "high",
      "premium",
      { type: "subscription_activated" },
    );
    console.info("[ai/plans] welcomed", { userId, plan });
  } catch (e) {
    console.error("[ai/plans] welcome failed", { userId, plan, error: String(e).slice(0, 200) });
  }
}
