import { NextResponse } from "next/server";
import { z } from "zod";

import { getAiEntitlementSnapshot } from "@/lib/ai/entitlement";
import { aiErrorBody, aiErrorStatus, isAiJobError } from "@/lib/ai/errors";
import { aiFeature } from "@/lib/ai/jobs";
import { createAiRewardSession, grantAiRewardSession } from "@/lib/ai/reward";
import { applyAiSubjectCookie, resolveAiSubject } from "@/lib/ai/subject-server";
import { peekAiUsage, unlockAiDay } from "@/lib/ai/usage";
import { aiJobCreateLimiter } from "@/lib/rate-limit";

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
  const feature0 = aiFeature("ai_clean");
  if (!feature0) {
    return NextResponse.json(aiErrorBody("FEATURE_UNAVAILABLE"), {
      status: aiErrorStatus("FEATURE_UNAVAILABLE"),
    });
  }

  /*
    🔴 NO SESSION REQUIRED. A guest earns and spends rewards exactly as a member
    does — that is the whole point of the guest tier, which is 2/day behind an
    ad. What identifies them is a signed, HttpOnly identifier the browser cannot
    forge, not a number it keeps.
  */
  const resolution = await resolveAiSubject(request, feature0.id);
  const { subject } = resolution;

  /*
    🔴 SIGNED IN, OR NOTHING (owner, 2026-09-09, standing Frenz AI rule).

    "Only authenticated/signed-in users can access Frenz AI. Logged-out users
    must not be able to open or use AI tools." `resolveAiSubject` returns null
    for anyone without a session, and the check lives in EVERY route rather
    than in a shared wrapper because §21 requires the backend to enforce this
    independently — a wrapper is one refactor away from being bypassed on one
    route and nobody noticing.

    AUTH_REQUIRED is 401: this is "sign in", not "you may not".
  */
  if (!subject) {
    return NextResponse.json(aiErrorBody("AUTH_REQUIRED"), { status: aiErrorStatus("AUTH_REQUIRED") });
  }

  // Keyed by member: this guards a per-account spend, and several people behind
  // one office address are not one abuser.
  const burst = await aiJobCreateLimiter.limit(`ai-reward:${subject.key}`);
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

  const feature = feature0;

  try {
    const usage = await peekAiUsage(subject, feature.id);
    const { view } = await getAiEntitlementSnapshot(subject, feature, usage);

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
      const session = await createAiRewardSession({ subject, feature: feature.id });
      console.info("[ai/reward] session opened", {
        subject: subject.key,
        feature: feature.id,
        sessionId: session.id,
        provider: session.provider,
      });
      return applyAiSubjectCookie(
        NextResponse.json(
        {
          sessionId: session.id,
          expiresAt: session.expiresAt,
          // Said out loud rather than hidden: this provider cannot PROVE the
          // ad was watched. See lib/ai/reward.ts.
          verifiable: session.verifiable,
          usage: view,
        },
        { headers: { "cache-control": "no-store" } },
        ),
        resolution,
      );
    }

    /* action: "grant" */
    if (!parsed.data.sessionId) {
      return NextResponse.json(aiErrorBody("INVALID_INPUT"), { status: aiErrorStatus("INVALID_INPUT") });
    }

    const result = await grantAiRewardSession({
      sessionId: parsed.data.sessionId,
      subject,
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

    /*
      ── 🔴 ONE AD FOR THE DAY, FOR THE PLANS THAT PAY ────────────────────────

      Owner, 2026-09-08: "Pro / Business / Max AI: one reward ad should unlock
      the applicable daily allowance… Do not show an ad after the generation
      has already been unlocked."

      So a `day`-scoped grant stamps today's usage row and is finished. The
      session is NOT claimed here and never will be — claiming is what spends a
      reward on ONE job, which is the `job` scope's mechanism (guest and free).
      Using the same path for both would either charge a paid member an ad per
      video or let a guest's single ad cover their whole day.

      The stamp grants no allowance of its own: the cap is still the cap, so a
      replayed unlock can only re-state a permission that is already true.
    */
    if (view.rewardScope === "day") {
      await unlockAiDay(subject, feature.id);
    }

    // Re-read, so the response tells the truth about what the grant just
    // changed rather than echoing the state from before it.
    const after = await peekAiUsage(subject, feature.id);
    const { view: updated } = await getAiEntitlementSnapshot(subject, feature, after);

    return applyAiSubjectCookie(
      NextResponse.json(
        { granted: true, sessionId: parsed.data.sessionId, usage: updated },
        { headers: { "cache-control": "no-store" } },
      ),
      resolution,
    );
  } catch (e) {
    if (isAiJobError(e)) {
      return NextResponse.json(aiErrorBody(e.code), { status: aiErrorStatus(e.code) });
    }
    console.error("[ai/reward] route threw", { subject: subject.key, error: String(e) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}
