import { NextResponse } from "next/server";

import { normalizePlanSurvey, type PlanFamily } from "@/lib/ai/credits/plan-survey";
import { getAiSubscription } from "@/lib/ai/credits/subscription";
import { aiJobReadLimiter } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/subscriptions/survey — the optional plan survey from the
 * celebration sheet (0190), for the AI plans AND the Frenzsave plans (owner
 * 2026-10-07: "on all plans"). The body says only which FAMILY it answers
 * (`family: "ai" | "site"`); the plan itself is the one the member's own
 * subscription row says is active — never one the body names.
 * The first answer per plan is kept (a second submit is a no-op), and an
 * empty answer is not stored at all.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const burst = await aiJobReadLimiter.limit(`ai-plan-survey:${user.id}`);
  if (!burst.success) return NextResponse.json({ error: "Too many attempts." }, { status: 429 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const family: PlanFamily = (body as { family?: unknown })?.family === "site" ? "site" : "ai";
  const answer = normalizePlanSurvey(body, family);
  if (!answer) return NextResponse.json({ ok: true, stored: false });

  let plan: string | null = null;
  if (family === "ai") {
    const sub = await getAiSubscription(user.id).catch(() => null);
    plan = sub?.active ? sub.plan : null;
  } else {
    // the PAID subscription row — not getUserPlan, which counts a site-wide promo as Pro
    const { data: row } = await createAdminClient().from("subscriptions").select("plan, status").eq("user_id", user.id).maybeSingle();
    const r = row as { plan?: string; status?: string } | null;
    plan = r && (r.status === "active" || r.status === "trialing") && (r.plan === "pro" || r.plan === "business") ? r.plan : null;
  }
  if (!plan) return NextResponse.json({ error: "The survey is for members with an active plan." }, { status: 403 });

  const { error } = await createAdminClient()
    .from("ai_plan_survey_responses")
    .upsert({ user_id: user.id, plan, features: answer.features, goal: answer.goal, comment: answer.comment }, { onConflict: "user_id,plan", ignoreDuplicates: true });
  if (error) {
    console.error("[ai/plans] survey store failed", { userId: user.id, message: error.message });
    return NextResponse.json({ error: "Couldn't save that right now." }, { status: 503 });
  }
  return NextResponse.json({ ok: true, stored: true });
}
