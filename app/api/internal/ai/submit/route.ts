import { NextResponse } from "next/server";
import { z } from "zod";

import { AI_CLEAN_CONFIG } from "@/lib/ai/config";
import { isAiJobError } from "@/lib/ai/errors";
import { aiFeature } from "@/lib/ai/jobs";
import { getJobAsService } from "@/lib/ai/job-store";
import { submitJobToProvider } from "@/lib/ai/submit";
import { WORKER_SECRET } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** One provider API call. Nothing here moves video. */
export const maxDuration = 60;

/**
 * POST /api/internal/ai/submit — THE WORKER CALLING THE FRONTEND.
 *
 * ── 🔴 THE ONLY MESSAGE THAT TRAVELS WORKER → FRONTEND ──────────────────────
 *
 * Part 6's acquisition runs on the Docker worker (it needs yt-dlp and a real
 * filesystem). Submitting to Replicate needs `REPLICATE_API_TOKEN`, which lives
 * on Vercel and only on Vercel. Rather than copy a payment credential onto a
 * second host, the worker stores the video and then asks here.
 *
 * See lib/ai/submit-dispatch.ts for why that trade is the right way round.
 *
 * ── The request is one uuid ─────────────────────────────────────────────────
 *
 * No model, no engine, no source url, no owner. Everything is read from the row.
 * A body that could name a model would let anyone holding the shared secret
 * point the owner's Replicate credit at an arbitrary model and bill them for it
 * — which is exactly the guarantee `/api/ai/jobs` gives about the public API,
 * and it must not be weaker on an internal one.
 *
 * ── It reports the real outcome ─────────────────────────────────────────────
 *
 * Unlike the two dispatch endpoints, this one AWAITS the submission and answers
 * with what happened, because the worker is holding a stored video and a
 * reserved allowance slot and has to know whether to refund them. A 202 here
 * would leave the job in `acquiring` with nothing coming.
 */
const schema = z.object({ jobId: z.string().uuid() }).strict();

export async function POST(request: Request) {
  // Same posture as every other internal route: enforce when configured.
  if (WORKER_SECRET && request.headers.get("x-worker-secret") !== WORKER_SECRET) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  if (!WORKER_SECRET) {
    console.warn(
      "[ai/submit] WORKER_SECRET is not set — this endpoint is UNAUTHENTICATED and it spends provider credit. Set it on both the worker and the frontend.",
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: "INVALID_BODY" }, { status: 400 });
  }

  const { jobId } = parsed.data;

  try {
    const job = await getJobAsService(jobId);
    if (!job) return NextResponse.json({ ok: false, code: "JOB_NOT_FOUND" }, { status: 404 });

    const feature = aiFeature(job.feature);
    if (!feature) return NextResponse.json({ ok: false, code: "FEATURE_UNAVAILABLE" }, { status: 200 });

    /*
      🔴 `acquiring` ONLY, and the transition inside `submitJobToProvider` is a
      compare-and-set against the same status. A job that was cancelled while
      the worker was downloading matches no row and is not resurrected, and a
      duplicate delivery of this call finds the job already `processing` and
      changes nothing — the same idempotency shape as the webhook.
    */
    if (job.status !== "acquiring") {
      return NextResponse.json({ ok: true, skipped: `status is ${job.status}` }, { status: 200 });
    }

    const { submission } = await submitJobToProvider(job, feature, { from: ["acquiring"] });

    console.info("[ai/submit] started from acquisition", {
      jobId,
      feature: feature.id,
      model: AI_CLEAN_CONFIG.model,
      modelVersion: submission.modelVersion,
      engine: submission.engine,
      predictionId: submission.reference,
      transition: "acquiring -> processing",
    });

    return NextResponse.json({ ok: true, jobId }, { status: 200 });
  } catch (e) {
    /*
      Answered as a 200 with `ok:false` rather than a 500. The caller is the
      worker, which reads the body and decides whether to refund — and a 500
      would be indistinguishable from the frontend being briefly unreachable,
      which is a different thing that deserves a different response.

      🔴 `code` only, never the provider's own message. `AiJobError.detail` can
      carry provider text and is never returned to a caller.
    */
    const code = isAiJobError(e) ? e.code : "PROVIDER_ERROR";
    console.error("[ai/submit] failed", { jobId, code, detail: isAiJobError(e) ? e.detail : String(e) });
    return NextResponse.json({ ok: false, code }, { status: 200 });
  }
}
