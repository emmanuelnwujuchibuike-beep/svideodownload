import { NextResponse } from "next/server";

import { getUserAIEntitlement } from "@/lib/ai/entitlement";
import { aiErrorBody, aiErrorStatus, isAiJobError, storedErrorMessage } from "@/lib/ai/errors";
import { aiFeature, jobToView } from "@/lib/ai/jobs";
import { getOwnJob, transitionJob } from "@/lib/ai/job-store";
import { providerFor } from "@/lib/ai/providers";
import { releaseAiUsage } from "@/lib/ai/usage";
import { aiJobCreateLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

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
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const burst = await aiJobCreateLimiter.limit(`ai-cancel:${userId}`);
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
    const job = await getOwnJob(userId, id);
    if (!job) {
      return NextResponse.json(aiErrorBody("JOB_NOT_FOUND"), { status: aiErrorStatus("JOB_NOT_FOUND") });
    }

    // Already finished. Answering with the job rather than an error keeps a
    // double tap harmless.
    if (job.status !== "queued" && job.status !== "processing") {
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

    const updated = await transitionJob(job.id, ["queued", "processing"], "cancelled", {
      completed_at: new Date().toISOString(),
    });

    if (updated && feature) {
      const entitlement = await getUserAIEntitlement(userId, feature);
      await releaseAiUsage(userId, feature.id, entitlement.dailyLimit);
      console.info("[ai/jobs] cancelled", {
        jobId: job.id,
        userId,
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
    console.error("[ai/jobs] cancel threw", { userId, jobId: id, error: String(e) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}
