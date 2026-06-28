import { createAdminClient } from "@/lib/supabase/admin";

import type { BillingPlan } from "./types";

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;

/** A user's effective plan. Anonymous or unknown users are always "free". */
export async function getUserPlan(userId: string | null | undefined): Promise<BillingPlan> {
  if (!userId || !hasSupabase) return "free";
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("subscriptions")
      .select("plan, status")
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) return "free";
    if (data.status === "active" || data.status === "trialing") {
      return (data.plan as BillingPlan) ?? "free";
    }
    return "free";
  } catch {
    return "free";
  }
}

export function planRank(plan: BillingPlan): number {
  return plan === "business" ? 2 : plan === "pro" ? 1 : 0;
}

export interface PlanLimits {
  ads: boolean;
  dailyDownloads: number;
  batch: boolean;
  apiAccess: boolean;
  apiDailyLimit: number;
}

/**
 * Default plan entitlements. The numeric caps (`dailyDownloads`,
 * `apiDailyLimit`) can be overridden per-plan by an admin via the dashboard;
 * overrides live in the `settings` table under key `plan_limits`. Use
 * `getPlanLimits()` to read the effective (override-aware) values.
 */
export const DEFAULT_PLAN_LIMITS: Record<BillingPlan, PlanLimits> = {
  free: { ads: true, dailyDownloads: 30, batch: false, apiAccess: true, apiDailyLimit: 50 },
  pro: { ads: false, dailyDownloads: 1000, batch: true, apiAccess: true, apiDailyLimit: 500 },
  business: { ads: false, dailyDownloads: 10000, batch: true, apiAccess: true, apiDailyLimit: 50000 },
};

const PLANS: BillingPlan[] = ["free", "pro", "business"];

/** The two admin-editable caps per plan. */
export interface EditableLimits {
  dailyDownloads: number;
  apiDailyLimit: number;
}

function mergeLimits(
  overrides: Partial<Record<BillingPlan, Partial<PlanLimits>>> | null,
): Record<BillingPlan, PlanLimits> {
  const out = {} as Record<BillingPlan, PlanLimits>;
  for (const plan of PLANS) {
    out[plan] = { ...DEFAULT_PLAN_LIMITS[plan], ...(overrides?.[plan] ?? {}) };
  }
  return out;
}

// Short in-process cache so the hot paths (every API call / download) don't hit
// the DB each time. Admin edits bust this instance's cache immediately and
// propagate to other serverless instances within the TTL.
const LIMITS_TTL_MS = 60_000;
let limitsCache: { at: number; value: Record<BillingPlan, PlanLimits> } | null = null;

/** Effective plan limits — defaults with any admin overrides applied. */
export async function getPlanLimits(): Promise<Record<BillingPlan, PlanLimits>> {
  if (limitsCache && Date.now() - limitsCache.at < LIMITS_TTL_MS) {
    return limitsCache.value;
  }
  if (!hasSupabase) return DEFAULT_PLAN_LIMITS;
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("settings")
      .select("value")
      .eq("key", "plan_limits")
      .maybeSingle();
    const merged = mergeLimits(
      (data?.value ?? null) as Partial<Record<BillingPlan, Partial<PlanLimits>>> | null,
    );
    limitsCache = { at: Date.now(), value: merged };
    return merged;
  } catch {
    return DEFAULT_PLAN_LIMITS;
  }
}

/** Admin: persist the editable caps for every plan. */
export async function setPlanLimits(
  limits: Record<BillingPlan, EditableLimits>,
): Promise<void> {
  const db = createAdminClient();
  await db.from("settings").upsert({ key: "plan_limits", value: limits }, { onConflict: "key" });
  limitsCache = null; // bust this instance immediately
}
