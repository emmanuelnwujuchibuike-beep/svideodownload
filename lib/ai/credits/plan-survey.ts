import { AI_CREDIT_FEATURES, AI_FEATURE_LABELS } from "@/lib/ai/credits/features";

/**
 * The optional plan survey (owner, 2026-10-07: "a subscription celebration and
 * an optional survey around the plans features" — and the same day: "the plan
 * welcome survey show on all plans and not just AI plans"). Pure — the
 * celebration sheet renders it, the API validates against it, so they cannot
 * disagree.
 *
 * Two families, one survey: the AI plans (AI Pro / AI Max) and the Frenzsave
 * plans (Pro / Business). Each family asks about ITS OWN features. Every answer
 * is optional; an empty submission is simply not stored.
 */
export type PlanFamily = "ai" | "site";
export type SurveyPlanId = "ai_pro" | "ai_max" | "pro" | "business";

export const PLAN_SURVEY_FEATURES = [
  ...AI_CREDIT_FEATURES.map((id) => ({ id: id as string, label: AI_FEATURE_LABELS[id] })),
  { id: "daily_credits", label: "The daily credit allowance" },
  { id: "priority_quality", label: "Higher quality results" },
] as const satisfies readonly { id: string; label: string }[];

/** The Frenzsave plan's own features — each one a real plan difference (lib/monetization/plan-features.ts). */
export const SITE_SURVEY_FEATURES = [
  { id: "no_ads", label: "No ads on downloads" },
  { id: "batch", label: "Bigger batch downloads" },
  { id: "daily_downloads", label: "More downloads a day" },
  { id: "cloud_storage", label: "More cloud storage" },
  { id: "ai_concurrency", label: "More Frenz AI at once" },
  { id: "api", label: "API access" },
] as const satisfies readonly { id: string; label: string }[];

export function surveyFeaturesFor(family: PlanFamily): readonly { id: string; label: string }[] {
  return family === "site" ? SITE_SURVEY_FEATURES : PLAN_SURVEY_FEATURES;
}

export function familyOfPlan(plan: string): PlanFamily | null {
  return plan === "ai_pro" || plan === "ai_max" ? "ai" : plan === "pro" || plan === "business" ? "site" : null;
}

export const PLAN_SURVEY_GOALS = [
  { id: "content", label: "Content for my socials" },
  { id: "business", label: "My business or brand" },
  { id: "fun", label: "Fun with friends" },
  { id: "learning", label: "Learning and experimenting" },
] as const;

export const PLAN_SURVEY_COMMENT_MAX = 500;

export interface PlanSurveyAnswer {
  features: string[];
  goal: string | null;
  comment: string | null;
}

/** Junk in, a clean answer out — or null when nothing was actually answered. Features are checked against the family's own list. */
export function normalizePlanSurvey(raw: unknown, family: PlanFamily = "ai"): PlanSurveyAnswer | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const allowed = new Set<string>(surveyFeaturesFor(family).map((f) => f.id));
  const features = Array.isArray(r.features) ? [...new Set(r.features.filter((f): f is string => typeof f === "string" && allowed.has(f)))] : [];
  const goal = typeof r.goal === "string" && PLAN_SURVEY_GOALS.some((g) => g.id === r.goal) ? r.goal : null;
  const comment = typeof r.comment === "string"
    ? r.comment.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, PLAN_SURVEY_COMMENT_MAX) || null
    : null;
  if (!features.length && !goal && !comment) return null;
  return { features, goal, comment };
}

export interface PlanSurveySummary {
  responses: number;
  byPlan: Record<string, number>;
  features: { id: string; label: string; count: number }[];
  goals: { id: string; label: string; count: number }[];
  comments: { plan: string; comment: string; at: string }[];
}

/** The admin's view of the answers (pure — counted here, read by lib/ai/credits/plan-survey-admin.ts). Features with no answers are left out. */
export function summarizePlanSurvey(rows: readonly { plan: string; features: string[] | null; goal: string | null; comment: string | null; created_at: string }[]): PlanSurveySummary {
  const byPlan: Record<string, number> = {};
  const feat = new Map<string, number>();
  const goals = new Map<string, number>();
  for (const r of rows) {
    byPlan[r.plan] = (byPlan[r.plan] ?? 0) + 1;
    for (const f of r.features ?? []) feat.set(f, (feat.get(f) ?? 0) + 1);
    if (r.goal) goals.set(r.goal, (goals.get(r.goal) ?? 0) + 1);
  }
  const every = [...PLAN_SURVEY_FEATURES, ...SITE_SURVEY_FEATURES];
  return {
    responses: rows.length,
    byPlan,
    features: every.map((f) => ({ id: f.id, label: f.label, count: feat.get(f.id) ?? 0 })).filter((f) => f.count > 0).sort((a, b) => b.count - a.count),
    goals: PLAN_SURVEY_GOALS.map((g) => ({ id: g.id, label: g.label, count: goals.get(g.id) ?? 0 })).sort((a, b) => b.count - a.count),
    comments: rows.filter((r) => r.comment).slice(0, 20).map((r) => ({ plan: r.plan, comment: r.comment!, at: r.created_at })),
  };
}
