import { NextResponse } from "next/server";

import { getAiEntitlement } from "@/lib/ai/entitlement";
import { aiErrorBody, aiErrorStatus, isAiJobError, storedErrorMessage } from "@/lib/ai/errors";
import { AI_ACTIVE_STATUSES, aiFeature, isActiveStatus, jobToView } from "@/lib/ai/jobs";
import { getOwnJob, transitionJob } from "@/lib/ai/job-store";
import { providerFor } from "@/lib/ai/providers";
import { releaseAiUsage } from "@/lib/ai/usage";
import { aiJobCreateLimiter } from "@/lib/rate-limit";
import { applyAiSubjectCookie, resolveAiSubject } from "@/lib/ai/subject-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/jobs/[id]/cancel — stop a job the member no longer wants.
 *
 * ── Why this exists at all ───────────────────────────────────────────────────
 *
 * A free member may have one job in flight. Without a way to stop one, a video
 * that was opened and never uploaded — a picker closed, a phone that slept, an
 * upload that died — would block their account until it aged out. That is a
 * dead end created by our own concurrency rule, and the fix belongs beside the
 * rule.
 *
 * ── What it does, in order ───────────────────────────────────────────────────
 *
 *   1. the job is this member's, and is still going to change;
 *   2. tell the provider to stop, if it ever started — best effort, because a
 *      prediction that already finished cannot be cancelled and that is not an
 *      error worth showing anyone;
 *   3. move the row to `cancelled`, compare-and-set so a double tap is a no-op;
 *   4. give the slot back, but ONLY on a transition that actually happened.
 *
 * ── The refund is honest, not generous ───────────────────────────────────────
 *
 * A cancelled run may already have cost provider time, and the member still
 * gets their slot back. That is deliberate: they asked for it to stop and
 * received nothing, and the refund cap in `release_ai_usage` is what stops the
 * generosity becoming a loop.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const feat = aiFeature("ai_clean");
  if (!feat) {
    return NextResponse.json(aiErrorBody("FEATURE_UNAVAILABLE"), {
      status: aiErrorStatus("FEATURE_UNAVAILABLE"),
    });
  }
  // A guest may abandon their own job. Stopping a run they started is the one
  // thing it would be actively rude to require an account for.
  const resolution = await resolveAiSubject(request, feat.id);
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

  const burst = await aiJobCreateLimiter.limit(`ai-cancel:${subject.key}`);
  if (!burst.success) {
    return NextResponse.json(aiErrorBody("RATE_LIMITED"), {
      status: aiErrorStatus("RATE_LIMITED"),
      headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) },
    });
  }

  const { id } = await params;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
    return NextResponse.json(aiErrorBody("JOB_NOT_FOUND"), { status: aiErrorStatus("JOB_NOT_FOUND") });
  }

  try {
    const job = await getOwnJob(subject, id);
    if (!job) {
      return NextResponse.json(aiErrorBody("JOB_NOT_FOUND"), { status: aiErrorStatus("JOB_NOT_FOUND") });
    }

    /*
      ── 🔴 EVERY RUNNING STATE MAY BE CANCELLED, NOT JUST TWO ───────────────

      Owner, 2026-09-09: "the stop anyway in the AI cancel button doesn't
      cancel."

      This read `status !== "queued" && status !== "processing"` and therefore
      refused `finalizing` — which is EXACTLY the state their job was stuck in.
      The button worked, the request was made, and the route answered "already
      finished" about a job that was still going. It also missed `acquiring`,
      the state Part 6 added, so a link job could not be stopped either.

      `isActiveStatus` is the registry's own answer to "is this still going to
      change", and asking it is what stops this list going stale a third time.
      The TRANSITIONS table already permitted both — only this route disagreed.

      ⚠️ Cancelling during `finalizing` is safe by construction: the worker's own
      `transitionJob(id, ["finalizing"], "completed")` is a compare-and-set, so a
      worker that finishes afterwards matches no row and quietly does nothing
      rather than resurrecting a job the member stopped.
    */
    if (!isActiveStatus(job.status)) {
      return NextResponse.json({ job: jobToView(job, storedErrorMessage), cancelled: false });
    }

    const feature = aiFeature(job.feature);

    if (job.replicate_prediction_id && feature) {
      const provider = providerFor(feature.provider);
      // Best effort, and never allowed to stop the cancellation: the member's
      // intent is recorded either way, and a prediction we could not reach is
      // the provider's problem, not theirs.
      if (provider) await provider.cancel(job.replicate_prediction_id).catch(() => false);
    }

    const updated = await transitionJob(job.id, [...AI_ACTIVE_STATUSES], "cancelled", {
      completed_at: new Date().toISOString(),
    });

    if (updated && feature) {
      const entitlement = await getAiEntitlement(subject, feature);
      await releaseAiUsage(subject, feature.id, entitlement.dailyLimit);
      console.info("[ai/jobs] cancelled", {
        jobId: job.id,
                feature: feature.id,
        transition: `${job.status} -> cancelled`,
        released: true,
      });
    }

    return NextResponse.json({
      job: jobToView(updated ?? job, storedErrorMessage),
      cancelled: !!updated,
    });
  } catch (e) {
    if (isAiJobError(e)) {
      return NextResponse.json(aiErrorBody(e.code), { status: aiErrorStatus(e.code) });
    }
    console.error("[ai/jobs] cancel threw", { subject: subject.key, jobId: id, error: String(e) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}
