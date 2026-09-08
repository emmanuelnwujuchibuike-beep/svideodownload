import { NextResponse } from "next/server";
import { z } from "zod";

import { getAiEntitlementSnapshot } from "@/lib/ai/entitlement";
import { aiErrorBody, aiErrorStatus, isAiJobError } from "@/lib/ai/errors";
import { aiFeature } from "@/lib/ai/jobs";
import { createAiRewardSession, grantAiRewardSession } from "@/lib/ai/reward";
import { peekAiUsage } from "@/lib/ai/usage";
import { aiJobCreateLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  POST /api/ai/clean/reward — open a reward session, or report the ad finished
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two actions on one route because they are two halves of one exchange and
 * share every check. `action: "open"` starts a short-lived session; `"grant"`
 * says the ad completed.
 *
 * ── 🔴 WHAT THE CLIENT MAY SAY ───────────────────────────────────────────────
 *
 * An action and, for a grant, a session id. That is all. The schema is
 * `.strict()`, so a body carrying `plan`, `skipAd`, `remaining`, `verified` or
 * a user id is REFUSED rather than ignored — the brief lists exactly those as
 * things a client must never assert, and a rejected field is easier to reason
 * about than a silently dropped one.
 *
 * ── 🔴 THE ALLOWANCE IS CHECKED BEFORE AN AD IS EVER OFFERED ─────────────────
 *
 * A rewarded ad unlocks a REMAINING session; it cannot create an extra one. So
 * a member with nothing left is refused here, before they watch anything.
 * Taking somebody's attention for an ad that cannot buy them a thing is the
 * worst outcome this endpoint could produce, and it is worth an extra read to
 * make impossible.
 */
const schema = z
  .object({
    action: z.enum(["open", "grant"]),
    sessionId: z.string().uuid().optional(),
  })
  .strict();

export async function POST(request: Request) {
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

  // Keyed by member: this guards a per-account spend, and several people behind
  // one office address are not one abuser.
  const burst = await aiJobCreateLimiter.limit(`ai-reward:${userId}`);
  if (!burst.success) {
    return NextResponse.json(aiErrorBody("RATE_LIMITED"), {
      status: aiErrorStatus("RATE_LIMITED"),
      headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) },
    });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(aiErrorBody("INVALID_INPUT"), { status: aiErrorStatus("INVALID_INPUT") });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(aiErrorBody("INVALID_INPUT"), { status: aiErrorStatus("INVALID_INPUT") });
  }

  const feature = aiFeature("ai_clean");
  if (!feature) {
    return NextResponse.json(aiErrorBody("FEATURE_UNAVAILABLE"), {
      status: aiErrorStatus("FEATURE_UNAVAILABLE"),
    });
  }

  try {
    const usedToday = await peekAiUsage(userId, feature.id);
    const { view } = await getAiEntitlementSnapshot(userId, feature, usedToday);

    // Nothing left today. No ad, and the limit-reached state instead.
    if (!view.canStart) {
      return NextResponse.json(aiErrorBody("DAILY_LIMIT_REACHED", { usage: view }), {
        status: aiErrorStatus("DAILY_LIMIT_REACHED"),
      });
    }

    // This plan does not owe an ad. Refusing rather than issuing a pointless
    // session keeps "who needs an ad" a server decision in both directions.
    if (!view.rewardRequired) {
      return NextResponse.json(
        aiErrorBody("INVALID_INPUT", { error: "This plan doesn't need a rewarded ad." }),
        { status: aiErrorStatus("INVALID_INPUT") },
      );
    }

    if (parsed.data.action === "open") {
      const session = await createAiRewardSession({ userId, feature: feature.id });
      console.info("[ai/reward] session opened", {
        userId,
        feature: feature.id,
        sessionId: session.id,
        provider: session.provider,
      });
      return NextResponse.json(
        {
          sessionId: session.id,
          expiresAt: session.expiresAt,
          // Said out loud rather than hidden: this provider cannot PROVE the
          // ad was watched. See lib/ai/reward.ts.
          verifiable: session.verifiable,
          usage: view,
        },
        { headers: { "cache-control": "no-store" } },
      );
    }

    /* action: "grant" */
    if (!parsed.data.sessionId) {
      return NextResponse.json(aiErrorBody("INVALID_INPUT"), { status: aiErrorStatus("INVALID_INPUT") });
    }

    const result = await grantAiRewardSession({
      sessionId: parsed.data.sessionId,
      userId,
      feature: feature.id,
    });

    if (!result.granted) {
      // One sentence for every reason. Telling somebody WHICH check they failed
      // — wrong user, expired, already spent — tells an attacker the same.
      return NextResponse.json(
        aiErrorBody("INVALID_INPUT", { error: "We couldn't verify that reward. Please try again." }),
        { status: aiErrorStatus("INVALID_INPUT") },
      );
    }

    return NextResponse.json(
      { granted: true, sessionId: parsed.data.sessionId, usage: view },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    if (isAiJobError(e)) {
      return NextResponse.json(aiErrorBody(e.code), { status: aiErrorStatus(e.code) });
    }
    console.error("[ai/reward] route threw", { userId, error: String(e) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}
