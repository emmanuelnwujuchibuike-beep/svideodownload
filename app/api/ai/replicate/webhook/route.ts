import { NextResponse } from "next/server";

import { aiFeature } from "@/lib/ai/jobs";
import { findJobByPredictionId, transitionJob } from "@/lib/ai/job-store";
import { stateFromWebhookBody } from "@/lib/ai/replicate/provider";
import { readWebhookHeaders, verifyReplicateWebhook } from "@/lib/ai/replicate/signature";
import { getUserAIEntitlement } from "@/lib/ai/entitlement";
import { storeResultFromUrl } from "@/lib/ai/storage-server";
import { consumeAiUsage, releaseAiUsage } from "@/lib/ai/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/*
  The success path copies the finished video out of Replicate and into our own
  private bucket, which is a real transfer of real megabytes. 300s matches the
  ceiling `app/api/internal/store-media` already uses for the same kind of work.
*/
export const maxDuration = 300;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  POST /api/ai/replicate/webhook — the only way a job ever finishes
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 THIS ENDPOINT IS PUBLIC, SO THE SIGNATURE IS THE WHOLE SECURITY MODEL ─
 *
 * Anyone can POST here. Without verification, a stranger who guesses the URL
 * could send `{"id":"…","status":"succeeded","output":"https://their-file"}`
 * and we would mark somebody's job complete and store THEIR file as that
 * member's result. The prediction id is not a secret either — it appears in our
 * own logs and responses. So:
 *
 *   1. the RAW body is read first and verified before anything parses it —
 *      re-serialising JSON changes bytes and breaks the signature;
 *   2. only then is it parsed;
 *   3. the prediction id is looked up against a UNIQUE column, so one callback
 *      resolves to exactly one job.
 *
 * ── Idempotency is the database's job, not a flag here ───────────────────────
 *
 * Replicate retries. `transitionJob` is a compare-and-set: it updates only from
 * the statuses a job is allowed to leave, so the second delivery of the same
 * callback matches no row and changes nothing. That is what stops a retry
 * double-charging usage, re-copying the file, or reopening a finished job.
 *
 * ── Always 200, even when we refuse ──────────────────────────────────────────
 *
 * A non-2xx makes Replicate retry, so anything that will never succeed on a
 * retry — a forged signature, an unknown prediction — is answered 200 with a
 * plain body and logged. Genuine transient failures on OUR side return 500 so a
 * retry does happen.
 */
export async function POST(request: Request) {
  const secret = process.env.REPLICATE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    // Nothing may be accepted without the means to check it. Loud on our side,
    // silent on theirs.
    console.error("[ai/webhook] REPLICATE_WEBHOOK_SECRET is not set — refusing every delivery");
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  // 🔴 text(), not json(). The signature covers these exact bytes.
  const rawBody = await request.text();
  const verdict = verifyReplicateWebhook({
    headers: readWebhookHeaders(request.headers),
    rawBody,
    secret,
  });

  if (!verdict.valid) {
    console.warn("[ai/webhook] rejected", { reason: verdict.reason });
    // 200: a forged or stale delivery will not become valid on a retry, and
    // answering 401 would only teach a prober which guesses got further.
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  const state = stateFromWebhookBody(body);
  if (!state) return NextResponse.json({ ok: false }, { status: 200 });

  try {
    const job = await findJobByPredictionId(state.reference);
    if (!job) {
      // Verified, but about a prediction we do not know. Nothing to do, and no
      // retry will change that.
      console.warn("[ai/webhook] no job for prediction", { predictionId: state.reference });
      return NextResponse.json({ ok: true, matched: false }, { status: 200 });
    }

    const feature = aiFeature(job.feature);
    if (!feature) return NextResponse.json({ ok: true }, { status: 200 });

    /* ── still running ────────────────────────────────────────────────────── */
    if (state.status === "processing" || state.status === "queued") {
      await transitionJob(job.id, ["queued"], "processing", {
        started_at: job.started_at ?? new Date().toISOString(),
      });
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    /* ── finished, one way or another ─────────────────────────────────────── */
    if (state.status === "completed") {
      const outputUrl = state.resultUrl;
      if (!outputUrl) {
        // Replicate says it succeeded and we cannot find a video in the output.
        // Treated as a provider failure and refunded, because the member has
        // nothing either way and the fault is not theirs.
        return await failJob(job.id, job.user_id, feature.id, "PROVIDER_ERROR", "succeeded with no usable output");
      }

      let stored: { path: string; size: number };
      try {
        stored = await storeResultFromUrl({
          userId: job.user_id,
          feature: feature.id,
          jobId: job.id,
          sourceUrl: outputUrl,
        });
      } catch (e) {
        /*
          The AI worked; our copy of the result did not. 500 so Replicate
          retries — its output URL is still valid for a while, so a retry has a
          real chance, and the compare-and-set means a later success still
          lands exactly once. The job is deliberately NOT failed here.
        */
        console.error("[ai/webhook] result transfer failed", { jobId: job.id, error: String(e) });
        return NextResponse.json({ ok: false }, { status: 500 });
      }

      const updated = await transitionJob(job.id, ["queued", "processing"], "completed", {
        result_path: stored.path,
        result_size: stored.size,
        model_version: state.modelVersion ?? job.model_version,
        completed_at: new Date().toISOString(),
        error_code: null,
        error_message: null,
      });

      if (updated) {
        // Only on a transition that actually happened — a retried delivery must
        // not count a second successful job against the allowance.
        await consumeAiUsage(job.user_id, feature.id);
        console.info("[ai/webhook] completed", {
          jobId: job.id,
          userId: job.user_id,
          feature: feature.id,
          provider: "replicate",
          modelVersion: state.modelVersion,
          predictionId: state.reference,
          resultSize: stored.size,
          transition: `${job.status} -> completed`,
        });
      }
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    if (state.status === "failed") {
      return await failJob(job.id, job.user_id, feature.id, "PROCESSING_FAILED", state.detail);
    }

    if (state.status === "cancelled") {
      const updated = await transitionJob(job.id, ["queued", "processing"], "cancelled", {
        completed_at: new Date().toISOString(),
      });
      if (updated) {
        // A cancelled run still consumed provider time, but the member asked for
        // it to stop and got nothing — the slot goes back.
        await refund(job.user_id, feature.id);
      }
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    console.error("[ai/webhook] threw", { predictionId: state.reference, error: String(e) });
    // Our side broke. 500 asks for the retry that might succeed.
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

/** Mark it failed, refund the slot, and never store the provider's words. */
async function failJob(
  jobId: string,
  userId: string,
  feature: Parameters<typeof consumeAiUsage>[1],
  code: string,
  detail: string | null | undefined,
) {
  const updated = await transitionJob(jobId, ["queued", "processing"], "failed", {
    error_code: code,
    // Operator-facing only. `jobToView` never selects this column into a
    // response, so a provider's stack trace cannot reach a browser.
    error_message: detail ? detail.slice(0, 2000) : null,
    completed_at: new Date().toISOString(),
  });

  if (updated) {
    await refund(userId, feature);
    console.error("[ai/webhook] failed", {
      jobId,
      userId,
      feature,
      code,
      transition: "-> failed",
      released: true,
    });
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}

/**
 * Give the slot back.
 *
 * The entitlement is re-resolved because the refund cap is the member's own
 * daily allowance, and a webhook has no session to read it from. `getUserPlan`
 * is a single indexed read and this path runs at most once per job.
 */
async function refund(userId: string, feature: Parameters<typeof consumeAiUsage>[1]) {
  const def = aiFeature(feature);
  if (!def) return;
  const entitlement = await getUserAIEntitlement(userId, def);
  await releaseAiUsage(userId, feature, entitlement.dailyLimit);
}
