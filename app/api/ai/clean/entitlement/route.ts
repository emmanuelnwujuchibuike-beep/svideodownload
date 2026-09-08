import { NextResponse } from "next/server";

import { getAiEntitlementSnapshot } from "@/lib/ai/entitlement";
import { aiErrorBody, aiErrorStatus, isAiJobError } from "@/lib/ai/errors";
import { aiFeature } from "@/lib/ai/jobs";
import { peekAiUsage } from "@/lib/ai/usage";
import { aiJobReadLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/clean/entitlement — what this member may do right now.
 *
 * ── 🔴 THIS IS FOR DISPLAY. IT IS NOT AN AUTHORIZATION. ──────────────────────
 *
 * Everything it returns is re-resolved from scratch when a job is actually
 * started, because between this response and that request a member can change
 * plan, spend their last slot in another tab, or edit anything they like in the
 * one place this value lives — their own browser.
 *
 * So nothing here is ever read back as truth. It exists so the interface can
 * say "1 of 3 left today" instead of guessing, and so a Pro member is never
 * shown an ad prompt that would not have applied to them.
 *
 * `no-store`, because a cached allowance is a wrong allowance the moment a job
 * finishes.
 */
export async function GET() {
  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    /* anonymous */
  }
  if (!userId) {
    return NextResponse.json(aiErrorBody("AUTH_REQUIRED"), { status: aiErrorStatus("AUTH_REQUIRED") });
  }

  const burst = await aiJobReadLimiter.limit(`ai-entitlement:${userId}`);
  if (!burst.success) {
    return NextResponse.json(aiErrorBody("RATE_LIMITED"), {
      status: aiErrorStatus("RATE_LIMITED"),
      headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) },
    });
  }

  const feature = aiFeature("ai_clean");
  if (!feature) {
    return NextResponse.json(aiErrorBody("FEATURE_UNAVAILABLE"), {
      status: aiErrorStatus("FEATURE_UNAVAILABLE"),
    });
  }

  try {
    /*
      The count comes from `ai_usage_daily` — the same table the atomic
      reservation writes, and the same one that decides whether a job may start.
      A second source for "how many today" is a second answer, and the wrong one
      would be the one on screen.
    */
    const usedToday = await peekAiUsage(userId, feature.id);
    const { view } = await getAiEntitlementSnapshot(userId, feature, usedToday);

    return NextResponse.json(view, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (isAiJobError(e)) {
      return NextResponse.json(aiErrorBody(e.code), { status: aiErrorStatus(e.code) });
    }
    console.error("[ai/entitlement] threw", { userId, error: String(e) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}
