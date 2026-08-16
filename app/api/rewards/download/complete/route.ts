import { NextResponse } from "next/server";
import { z } from "zod";

import { RewardError, completeRewardSession } from "@/lib/monetization/reward-sessions";
import { clientId, rewardCompleteLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import type { ApiError } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ rewardSessionId: z.string().uuid() });

function fail(code: ApiError["code"], error: string, status: number) {
  return NextResponse.json<ApiError>({ error, code }, { status });
}

/**
 * Mark a reward session granted after the ad UI reports a reward, and hand
 * back the exact items it authorizes. Idempotent and daily-limit-aware — see
 * lib/monetization/reward-sessions.ts's `completeRewardSession`.
 */
export async function POST(request: Request) {
  const clientIp = clientId(request.headers);
  const { success } = await rewardCompleteLimiter.limit(clientIp);
  if (!success) return fail("RATE_LIMITED", "Too many requests. Please wait a moment.", 429);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("INVALID_REQUEST", "Invalid request body.", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return fail("INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid request.", 400);
  }

  let userId: string | null = null;
  try {
    if (request.headers.get("cookie")?.includes("-auth-token")) {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      userId = user?.id ?? null;
    }
  } catch {
    /* signed out */
  }

  try {
    const result = await completeRewardSession({
      rewardSessionId: parsed.data.rewardSessionId,
      userId,
      ip: clientIp,
    });
    return NextResponse.json({ rewardSessionId: parsed.data.rewardSessionId, items: result.items });
  } catch (e) {
    if (e instanceof RewardError) {
      const status = e.code === "DAILY_LIMIT_REACHED" ? 429 : e.code === "DOWNLOAD_NOT_FOUND" ? 404 : 400;
      return fail(e.code, e.message, status);
    }
    return fail("INTERNAL", "Couldn't complete the reward.", 500);
  }
}
