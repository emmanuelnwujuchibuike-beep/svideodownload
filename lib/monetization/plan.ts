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

/** Plan entitlements — the single source of truth for gating features. */
export const PLAN_LIMITS: Record<
  BillingPlan,
  { ads: boolean; dailyDownloads: number; batch: boolean; apiAccess: boolean; apiDailyLimit: number }
> = {
  free: { ads: true, dailyDownloads: 30, batch: false, apiAccess: true, apiDailyLimit: 50 },
  pro: { ads: false, dailyDownloads: 1000, batch: true, apiAccess: true, apiDailyLimit: 500 },
  business: { ads: false, dailyDownloads: 10000, batch: true, apiAccess: true, apiDailyLimit: 10000 },
};
