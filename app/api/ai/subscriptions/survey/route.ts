import { NextResponse } from "next/server";

import { normalizePlanSurvey } from "@/lib/ai/credits/plan-survey";
import { getAiSubscription } from "@/lib/ai/credits/subscription";
import { aiJobReadLimiter } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/subscriptions/survey — the optional plan survey from the
 * celebration sheet (0190). The member's own, from the session; the plan is
 * the one their subscription row says is active — never one the body names.
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
  const answer = normalizePlanSurvey(body);
  if (!answer) return NextResponse.json({ ok: true, stored: false });

  const sub = await getAiSubscription(user.id).catch(() => null);
  if (!sub?.active) return NextResponse.json({ error: "The survey is for members with an active AI plan." }, { status: 403 });

  const { error } = await createAdminClient()
    .from("ai_plan_survey_responses")
    .upsert({ user_id: user.id, plan: sub.plan, features: answer.features, goal: answer.goal, comment: answer.comment }, { onConflict: "user_id,plan", ignoreDuplicates: true });
  if (error) {
    console.error("[ai/plans] survey store failed", { userId: user.id, message: error.message });
    return NextResponse.json({ error: "Couldn't save that right now." }, { status: 503 });
  }
  return NextResponse.json({ ok: true, stored: true });
}
