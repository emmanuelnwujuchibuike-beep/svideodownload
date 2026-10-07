import "server-only";

import { summarizePlanSurvey, type PlanSurveySummary } from "@/lib/ai/credits/plan-survey";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Admin → Frenz AI → the optional plan survey's answers (0190). Read only when
 * an admin opens the page. Newest first, capped at 1,000 rows (one PostgREST
 * page) — the cap is said on the panel. Null when the table cannot be read
 * (before 0190 is live), and the panel then shows nothing rather than zeros.
 */
const CAP = 1000;

export async function loadPlanSurveySummary(): Promise<(PlanSurveySummary & { capped: boolean }) | null> {
  const { data, error } = await createAdminClient()
    .from("ai_plan_survey_responses")
    .select("plan, features, goal, comment, created_at")
    .order("created_at", { ascending: false })
    .limit(CAP);
  if (error) {
    console.error("[ai/plans] survey read failed", { message: error.message });
    return null;
  }
  const rows = (data ?? []) as { plan: string; features: string[] | null; goal: string | null; comment: string | null; created_at: string }[];
  return { ...summarizePlanSurvey(rows), capped: rows.length >= CAP };
}
