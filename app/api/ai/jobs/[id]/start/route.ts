import { NextResponse } from "next/server";

import { AI_CLEAN_CONFIG, AI_CLEAN_LIMITS } from "@/lib/ai/config";
import { getUserAIEntitlement, usageForClient } from "@/lib/ai/entitlement";
import { aiErrorBody, aiErrorStatus, isAiJobError, storedErrorMessage } from "@/lib/ai/errors";
import { aiFeature, jobToView } from "@/lib/ai/jobs";
import { getOwnJob, recordUploadedSource, transitionJob } from "@/lib/ai/job-store";
import { providerFor } from "@/lib/ai/providers";
import { pathBelongsTo } from "@/lib/ai/storage";
import { signSourceUrl, statSourceObject } from "@/lib/ai/storage-server";
import { peekAiUsage, releaseAiUsage, reserveAiUsage } from "@/lib/ai/usage";
import { aiJobCreateLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  POST /api/ai/jobs/[id]/start — the upload is done; begin processing
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The only endpoint that spends anything, and therefore the one whose ORDER
 * matters most.
 *
 *   1. identity + burst
 *   2. the job is this member's, and is still `queued`
 *   3. the OBJECT REALLY EXISTS, at the path the server chose, and is what it
 *      claims to be — the browser's numbers from creation are ignored here
 *   4. reserve the slot                    ← the first thing that costs
 *   5. submit to the provider
 *   6. on failure, RELEASE the slot and fail the job
 *   7. on success, record the prediction id and move to `processing`
 *
 * ── 🔴 WHY VALIDATION COMES BEFORE THE CHARGE ────────────────────────────────
 *
 * Everything that can refuse a job for the member's own reasons — no file, the
 * wrong file, too big — happens before step 4, so a rejected upload never costs
 * one of three daily runs. Everything that can fail for OUR reasons happens
 * after it, and every one of those paths releases.
 *
 * ── The request body is empty, deliberately ──────────────────────────────────
 *
 * There is nothing left for the client to say. The path is the server's, the
 * size and type are read from storage, the model and its parameters are
 * configuration. A body would only be a place to try to influence one of them.
 */

/** A job left `queued` this long with nothing uploaded is abandoned, not busy. */
const ABANDONED_AFTER_MS = 30 * 60 * 1000;

function fail(code: Parameters<typeof aiErrorBody>[0], extra?: Record<string, unknown>) {
  return NextResponse.json(aiErrorBody(code, extra), { status: aiErrorStatus(code) });
}

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
  if (!userId) return fail("AUTH_REQUIRED");

  const burst = await aiJobCreateLimiter.limit(`ai-start:${userId}`);
  if (!burst.success) {
    return NextResponse.json(aiErrorBody("RATE_LIMITED"), {
      status: aiErrorStatus("RATE_LIMITED"),
      headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) },
    });
  }

  const { id } = await params;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return fail("JOB_NOT_FOUND");

  try {
    /* 2 · OWNERSHIP. Read as the member, so RLS decides, plus an id filter. */
    const job = await getOwnJob(userId, id);
    if (!job) return fail("JOB_NOT_FOUND");

    const feature = aiFeature(job.feature);
    if (!feature) return fail("FEATURE_UNAVAILABLE");

    // Already running or finished. Returning the job rather than an error makes
    // a double-tap on "Continue" harmless — the second call is a no-op that
    // answers with the same state the first produced.
    if (job.status !== "queued") {
      return NextResponse.json({ job: jobToView(job, storedErrorMessage), started: false });
    }

    const provider = providerFor(feature.provider);
    if (!provider || !provider.isConfigured()) return fail("FEATURE_UNAVAILABLE");

    /*
      3 · THE FILE ITSELF.

      🔴 The path comes from the ROW, where the server wrote it when it minted
      the upload ticket — never from the request. `pathBelongsTo` re-checks that
      it starts with this member's id and this job's id, because the value is
      about to become a signed URL handed to a third party, and "it was in the
      database" is not on its own a statement about whose it is.
    */
    const expectedPath = job.source_path;
    if (!expectedPath || !pathBelongsTo(expectedPath, userId, job.id)) {
      // No reserved key, or one that does not belong to this member and this
      // job. Either is a row that should not exist; refusing beats acting on it.
      console.error("[ai/jobs] source path failed ownership", { jobId: job.id, userId });
      return fail("INTERNAL_ERROR");
    }

    const stored = await statSourceObject(expectedPath);
    if (!stored) {
      // Nothing was uploaded. Not a failure of the job — the member simply has
      // not finished, or the upload died — so the job stays `queued` and
      // nothing is charged.
      const age = Date.now() - Date.parse(job.created_at);
      return fail("INVALID_INPUT", {
        error: age > ABANDONED_AFTER_MS ? "That upload didn't finish. Choose the video again." : "The upload hasn't finished yet.",
      });
    }

    if (stored.size <= 0) return fail("INVALID_INPUT");
    if (stored.size > AI_CLEAN_LIMITS.maxFileSize) return fail("FILE_TOO_LARGE");
    if (stored.mimeType && !AI_CLEAN_LIMITS.allowedMimeTypes.includes(stored.mimeType.toLowerCase())) {
      return fail("UNSUPPORTED_FORMAT");
    }

    // What was really stored replaces what the browser claimed at creation.
    await recordUploadedSource(job.id, {
      path: expectedPath,
      size: stored.size,
      mimeType: stored.mimeType,
    });

    /* 4 · THE CHARGE. Atomic, and the first thing here that costs anything. */
    const entitlement = await getUserAIEntitlement(userId, feature);
    if (!entitlement.allowed) return fail("FEATURE_UNAVAILABLE");

    const reservation = await reserveAiUsage(userId, feature.id, entitlement.dailyLimit);
    if (!reservation.allowed) {
      return fail("DAILY_LIMIT_REACHED", { usage: usageForClient(entitlement, reservation.used) });
    }

    /* 5 · THE PROVIDER. Everything from here releases on failure. */
    try {
      const sourceUrl = await signSourceUrl(expectedPath);
      const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || new URL(_request.url).origin;

      const state = await provider.submit({
        jobId: job.id,
        feature,
        sourceUrl,
        webhookUrl: `${origin}/api/ai/replicate/webhook`,
      });

      const updated = await transitionJob(job.id, ["queued"], "processing", {
        replicate_prediction_id: state.reference,
        model: AI_CLEAN_CONFIG.model,
        // What ACTUALLY ran, as the provider reported it — not our intention.
        model_version: state.modelVersion,
        started_at: new Date().toISOString(),
      });

      console.info("[ai/jobs] started", {
        jobId: job.id,
        userId,
        feature: feature.id,
        provider: feature.provider,
        model: AI_CLEAN_CONFIG.model,
        modelVersion: state.modelVersion,
        predictionId: state.reference,
        transition: "queued -> processing",
      });

      return NextResponse.json({
        job: jobToView(updated ?? { ...job, status: "processing" }, storedErrorMessage),
        started: true,
        usage: usageForClient(entitlement, reservation.used),
      });
    } catch (providerError) {
      /*
        🔴 OURS OR THE PROVIDER'S — SO IT IS FREE.

        The slot goes back, the job is marked failed with a code, and the
        member is told they can try again. Charging somebody for the moment our
        provider was unreachable is the single most corrosive thing a metered
        feature can do.
      */
      await releaseAiUsage(userId, feature.id, entitlement.dailyLimit);
      const code = isAiJobError(providerError) ? providerError.code : "PROVIDER_ERROR";
      const detail = isAiJobError(providerError) ? providerError.detail : String(providerError);

      await transitionJob(job.id, ["queued"], "failed", {
        error_code: code,
        error_message: detail?.slice(0, 2000) ?? null,
        completed_at: new Date().toISOString(),
      });

      console.error("[ai/jobs] provider submit failed", {
        jobId: job.id,
        userId,
        feature: feature.id,
        code,
        transition: "queued -> failed",
        released: true,
      });

      return fail(code === "FEATURE_UNAVAILABLE" ? "FEATURE_UNAVAILABLE" : "PROVIDER_ERROR", {
        usage: usageForClient(entitlement, await peekAiUsage(userId, feature.id)),
      });
    }
  } catch (e) {
    if (isAiJobError(e)) {
      console.error("[ai/jobs] start failed", { userId, jobId: id, code: e.code, detail: e.detail });
      return fail(e.code);
    }
    console.error("[ai/jobs] start threw", { userId, jobId: id, error: String(e) });
    return fail("INTERNAL_ERROR");
  }
}
