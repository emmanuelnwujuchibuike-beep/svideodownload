import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { normalizePlanSurvey, PLAN_SURVEY_COMMENT_MAX, summarizePlanSurvey } from "@/lib/ai/credits/plan-survey";

/**
 * Owner, 2026-10-07: "I don't see deposited credit in Chris statement and they
 * are supposed to receive a push notification when their deposit was
 * successful or cancelled … when they subscribe for pro, they should receive a
 * subscription celebration and an optional survey around the plans features."
 */
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("🔴 a top-up return is a top-up return, not a plan return", () => {
  it("the plan-return reader claims the address only when ai_plan is in it", () => {
    const client = code("lib/ai/credits/client.ts");
    const fn = client.slice(client.indexOf("export function takeAiPlanReturn"));
    expect(fn).toContain("if (!plan) return null;");
    // teeth: the old condition let a bare ?reference= through
    expect(fn.slice(0, fn.indexOf("for (const k of"))).not.toContain("if (!plan && !reference) return null;");
  });
  it("every plan checkout puts ai_plan on its return (so the stricter reader still sees them)", () => {
    expect(code("app/api/ai/subscriptions/checkout/route.ts")).toMatch(/ai_plan=\$\{parsed\.data\.plan\}/);
    expect(code("lib/ai/credits/bachs-plans.ts")).toMatch(/&ai_plan=\$\{opts\.plan\}/);
  });
});

describe("🔴 a deposit is settled even when the member never comes back", () => {
  const rec = code("lib/ai/wallet/reconcile-topups.ts");
  it("asks Paystack about the member's OWN pending top-ups — on demand, bounded, never a timer", () => {
    expect(rec).toContain('.eq("user_id", userId)');
    expect(rec).toContain('.eq("status", "pending")');
    expect(rec).toContain(".limit(MAX_PER_PASS)");
    expect(rec).not.toMatch(/setInterval/);
    expect(rec).toContain("if (charge.metadata?.user_id !== userId) return 0;");
  });
  it("a checkout Paystack calls abandoned is cancelled only after 30 minutes (it may still be open)", () => {
    expect(rec).toContain("const CANCEL_AFTER_MS = 30 * 60_000;");
    expect(rec).toContain('(charge.status === "abandoned" && old)');
  });
  it("credits through the ONE settle path the return uses — the same once-only credit as the webhook", () => {
    expect(rec).toContain("settleCharacterReplaceCharge(userId, row.reference, charge)");
    const verify = code("app/api/ai/balance/topup/verify/route.ts");
    expect(verify).toContain("settleCharacterReplaceCharge(user.id, reference, charge)");
    expect(code("lib/ai/wallet/paystack-settle.ts")).toContain("creditVerifiedCharacterReplaceRecharge({");
  });
  it("the credits page's reads run it in the same wave, and re-read only when something was credited", () => {
    const bal = code("app/api/ai/character-replace/balance/route.ts");
    expect(bal).toContain("reconcileMemberTopupsWithin(subject.userId),");
    expect(bal).toContain("reconciled.credited > 0");
    expect(code("app/api/ai/wallet/summary/route.ts")).toContain("reconcileMemberTopupsWithin(subject.userId)");
  });
  it("a cancelled deposit is announced once (claimed on the attempt row), by push, never by email", () => {
    const n = code("lib/ai/topup-notify.ts");
    const fn = n.slice(n.indexOf("export async function notifyTopupCancelled"));
    expect(fn).toContain("claimTopupFailureNotification(opts.userId, opts.reference)");
    expect(fn).toContain('title: "Deposit cancelled"');
    expect(fn).not.toContain("sendTopupReceiptEmail");
    expect(code("lib/ai/wallet/paystack-settle.ts")).toContain("await notifyTopupCancelled({");
  });
});

describe("🔴 a new AI plan is celebrated once", () => {
  it("every activation path welcomes, and the welcome is a conditional claim (never twice, never on a renewal)", () => {
    expect(code("lib/ai/credits/bachs-plans.ts")).toContain("after(() => welcomeAiPlan(attempt.user_id, plan, config));");
    const ps = code("lib/ai/credits/paystack.ts");
    expect(ps).toContain("after(() => welcomeAiPlan(userId, plan, config));");
    expect(ps).toContain("after(() => welcomeAiPlan(userId, welcomed, config));");
    const w = code("lib/ai/credits/plan-welcome.ts");
    expect(w).toContain(".or(`welcomed_plan.is.null,welcomed_plan.neq.${plan}`)");
    expect(w).toContain("if (!(await claimPlanWelcome(userId, plan))) return;");
  });
  it("the survey route trusts the session's active plan, never the body", () => {
    const r = code("app/api/ai/subscriptions/survey/route.ts");
    expect(r).toContain("plan: sub.plan");
    expect(r).toContain("ignoreDuplicates: true");
    expect(code("supabase/migrations/0190_ai_plan_welcome_survey.sql")).toContain("revoke all on public.ai_plan_survey_responses from public, anon, authenticated;");
  });
  it("the celebration is code-split and celebrates the server's plan when opened from the push", () => {
    const page = code("features/ai/frenz-ai-usage-page.tsx");
    expect(page).toContain('dynamic(() => import("@/features/ai/credits/plan-celebration")');
    expect(page).toContain("if (e?.plan && e.subscription?.active) setCelebrate(");
  });
});

describe("the optional plan survey", () => {
  it("keeps only known features and goals, and cleans the comment", () => {
    const a = normalizePlanSurvey({ features: ["ai_text_to_video", "nope", "ai_text_to_video", 4], goal: "business", comment: "  more\u0000 styles\n\nplease " });
    expect(a).toEqual({ features: ["ai_text_to_video"], goal: "business", comment: "more styles please" });
    expect(normalizePlanSurvey({ goal: "hack", features: ["x"] })).toBeNull();
    expect(normalizePlanSurvey({})).toBeNull();
    expect(normalizePlanSurvey("junk")).toBeNull();
    expect(normalizePlanSurvey({ comment: "x".repeat(900) })?.comment).toHaveLength(PLAN_SURVEY_COMMENT_MAX);
  });
  it("counts answers per feature and goal for the admin", () => {
    const s = summarizePlanSurvey([
      { plan: "ai_pro", features: ["ai_lip_sync", "daily_credits"], goal: "fun", comment: "great", created_at: "2026-10-07T00:00:00Z" },
      { plan: "ai_max", features: ["ai_lip_sync"], goal: null, comment: null, created_at: "2026-10-06T00:00:00Z" },
    ]);
    expect(s.responses).toBe(2);
    expect(s.byPlan).toEqual({ ai_pro: 1, ai_max: 1 });
    expect(s.features[0]).toMatchObject({ id: "ai_lip_sync", count: 2 });
    expect(s.goals.find((g) => g.id === "fun")?.count).toBe(1);
    expect(s.comments).toEqual([{ plan: "ai_pro", comment: "great", at: "2026-10-07T00:00:00Z" }]);
  });
});
