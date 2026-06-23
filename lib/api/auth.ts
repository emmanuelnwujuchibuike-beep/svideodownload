import { NextResponse } from "next/server";

import { getUserPlan, PLAN_LIMITS } from "@/lib/monetization/plan";
import type { BillingPlan } from "@/lib/monetization/types";
import { metadataLimiter } from "@/lib/rate-limit";

import { bearerToken, verifyApiKey, type ApiKeyAuth } from "./keys";
import { dailyUsage } from "./usage";

export interface ApiContext extends ApiKeyAuth {
  plan: BillingPlan;
  limit: number;
  used: number;
}

type AuthResult = { ok: true; ctx: ApiContext } | { ok: false; response: NextResponse };

function err(error: string, code: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, code, ...extra }, { status });
}

/**
 * Authenticates + quota-checks a public API request. Returns the resolved
 * context or a ready-to-send error response (401 / 429).
 */
export async function authenticateApi(request: Request): Promise<AuthResult> {
  const token = bearerToken(request);
  const auth = await verifyApiKey(token);
  if (!auth) {
    return {
      ok: false,
      response: err("Invalid or missing API key.", "unauthorized", 401),
    };
  }

  // Short-window burst limit keyed by the key (defence-in-depth vs the daily cap).
  const burst = await metadataLimiter.limit(`api:${auth.keyId}`);
  if (!burst.success) {
    return { ok: false, response: err("Too many requests.", "rate_limited", 429) };
  }

  const plan = await getUserPlan(auth.userId);
  const limit = PLAN_LIMITS[plan].apiDailyLimit;
  const used = await dailyUsage(auth.keyId);
  if (used >= limit) {
    return {
      ok: false,
      response: err(
        `Daily quota reached (${limit}/day on the ${plan} plan). Upgrade for more.`,
        "quota_exceeded",
        429,
        { limit, used, plan },
      ),
    };
  }

  return { ok: true, ctx: { ...auth, plan, limit, used } };
}
