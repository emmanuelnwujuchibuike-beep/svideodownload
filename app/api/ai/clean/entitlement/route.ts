import { NextResponse } from "next/server";

import { getAiEntitlementSnapshot } from "@/lib/ai/entitlement";
import { aiErrorBody, aiErrorStatus, isAiJobError } from "@/lib/ai/errors";
import { aiFeature } from "@/lib/ai/jobs";
import { applyAiSubjectCookie, resolveAiSubject } from "@/lib/ai/subject-server";
import { peekAiUsage } from "@/lib/ai/usage";
import { aiJobReadLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/clean/entitlement — what this visitor may do right now.
 *
 * ── 🔴 THIS IS FOR DISPLAY. IT IS NOT AN AUTHORIZATION. ──────────────────────
 *
 * Everything it returns is re-resolved from scratch when a job is actually
 * started, because between this response and that request a visitor can change
 * plan, spend their last slot in another tab, or edit anything they like in the
 * one place this value lives — their own browser.
 *
 * So nothing here is ever read back as truth. It exists so the interface can
 * say "1 of 2 used today" instead of guessing, and so a Pro member is never
 * shown an ad prompt that would not have applied to them.
 *
 * ── 🔴 AND IT NO LONGER REQUIRES A SESSION ──────────────────────────────────
 *
 * Owner, 2026-09-08: "Do not force users to sign up before they can try the
 * AI." A signed-out visitor gets a real answer about a real allowance, because
 * they have a real allowance. `resolveAiSubject` mints them a signed, HttpOnly
 * identity if they do not have one — which is why this endpoint is also, in
 * practice, where a guest's identity is issued: it is the first AI call the
 * page makes.
 *
 * `no-store`, because a cached allowance is a wrong allowance the moment a job
 * finishes — and because a CDN caching one visitor's guest counter and serving
 * it to the next would be both wrong and a privacy failure.
 */
export async function GET(request: Request) {
  const feature = aiFeature("ai_clean");
  if (!feature) {
    return NextResponse.json(aiErrorBody("FEATURE_UNAVAILABLE"), {
      status: aiErrorStatus("FEATURE_UNAVAILABLE"),
    });
  }

  const resolution = await resolveAiSubject(request, feature.id);
  const { subject } = resolution;

  /*
    Keyed by the SUBJECT, not by IP. Several people behind one office address
    are not one abuser — and a guest's key is their own signed identifier, so
    this still bounds each visitor individually rather than punishing a network.
  */
  const burst = await aiJobReadLimiter.limit(`ai-entitlement:${subject.key}`);
  if (!burst.success) {
    return NextResponse.json(aiErrorBody("RATE_LIMITED"), {
      status: aiErrorStatus("RATE_LIMITED"),
      headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) },
    });
  }

  try {
    /*
      The counts come from `ai_usage_daily` — the same table the atomic
      reservation writes, and the same one that decides whether a job may start.
      A second source for "how many today" is a second answer, and the wrong one
      would be the one on screen.
    */
    const usage = await peekAiUsage(subject, feature.id);
    const { view } = await getAiEntitlementSnapshot(subject, feature, usage);

    return applyAiSubjectCookie(
      NextResponse.json(view, { headers: { "cache-control": "no-store" } }),
      resolution,
    );
  } catch (e) {
    if (isAiJobError(e)) {
      return NextResponse.json(aiErrorBody(e.code), { status: aiErrorStatus(e.code) });
    }
    console.error("[ai/entitlement] threw", { subject: subject.kind, error: String(e) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}
