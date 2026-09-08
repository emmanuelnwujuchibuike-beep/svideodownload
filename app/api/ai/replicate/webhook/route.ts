import { after, NextResponse } from "next/server";

import { aiErrorMessage } from "@/lib/ai/errors";
import { aiFeature, type AiFeature } from "@/lib/ai/jobs";
import { findJobByPredictionId, recordProviderOutput, transitionJob } from "@/lib/ai/job-store";
import { stateFromWebhookBody } from "@/lib/ai/replicate/provider";
import { readWebhookHeaders, verifyReplicateWebhook } from "@/lib/ai/replicate/signature";
import { getAiEntitlement } from "@/lib/ai/entitlement";
import { dispatchFinalization } from "@/lib/ai/finalize-dispatch";
import { notifyAiCleanFailed } from "@/lib/ai/notify";
import { subjectFromRow, type AiSubject } from "@/lib/ai/subject";
import { releaseAiUsage } from "@/lib/ai/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/*
  ⚠️ Was 300s in Part 3, when this route copied the finished video itself. It no
  longer moves a single byte of video: it records where the output is and hands
  the job to the ffmpeg worker (lib/ai/finalize-dispatch.ts). Two small database
  writes and a fire-and-forget POST.
*/
export const maxDuration = 30;

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
      /*
        ── 🔴 THE PROVIDER FINISHING IS NOT THE JOB FINISHING ──────────────────

        The model returns video with NO AUDIO. Marking this completed would hand
        the member a silent video, which is why the state machine no longer
        allows processing -> completed at all (lib/ai/jobs.ts).

        So this route does the two cheap, durable things — record where the
        output is, and ask the worker to finish — and nothing else. It moves no
        video: a 100 MB transfer inside a webhook is memory this platform bills
        by the millisecond, and a webhook that runs long is a webhook Replicate
        gives up on and redelivers.
      */
      const outputUrl = state.resultUrl;
      if (!outputUrl) {
        // Replicate says it succeeded and there is no video in the output.
        // Treated as a provider failure and refunded — the member has nothing
        // either way, and the fault is not theirs.
        return await failJob(job.id, subjectFromRow(job), feature.id, "PROVIDER_ERROR", "succeeded with no usable output");
      }

      try {
        // Written BEFORE the response, so a dispatch that never lands leaves a
        // job that can still be finalized later rather than one that has lost
        // the only link to its own output.
        await recordProviderOutput(job.id, outputUrl);
      } catch (e) {
        // Our database, our problem — 500 asks for the redelivery that fixes it.
        console.error("[ai/webhook] could not record provider output", { jobId: job.id, error: String(e) });
        return NextResponse.json({ ok: false }, { status: 500 });
      }

      /*
        Fired AFTER the response. `after()` is how this platform allows work to
        continue past a returned response — without it the function is frozen
        the moment we answer and the worker is never called. The job stays
        `processing` until the worker CLAIMS it with a compare-and-set, which
        is what makes two deliveries of this callback safe.
      */
      after(async () => {
        const dispatch = await dispatchFinalization(job.id);
        console.info("[ai/webhook] finalization dispatched", {
          jobId: job.id,
          userId: job.user_id,
          feature: feature.id,
          predictionId: state.reference,
          modelVersion: state.modelVersion,
          dispatched: dispatch.dispatched,
          ...(dispatch.dispatched ? {} : { reason: dispatch.reason }),
          ...(dispatch.dispatched === false && dispatch.reason === "refused"
            ? { status: dispatch.status, detail: dispatch.detail }
            : {}),
        });

        /*
          ── 🔴 A REFUSED HANDOFF ENDS THE JOB. IT USED TO ORPHAN IT. ────────

          This block previously logged the outcome and stopped. When the worker
          refused, the job stayed `processing` with nowhere left to go: we had
          already answered Replicate 200 so it never redelivered, and the only
          thing that would eventually touch the row was the 45-minute stall
          deadline — by which time Replicate had expired the output file, so
          the member got "succeeded with no usable output", which is both
          confusing and untrue.

          That was the whole bug. Every AI Clean job ever created died in this
          silence.

          A 403/404 from our own worker cannot improve on a retry, so the job
          ends NOW with an honest error and the allowance goes back. Transient
          failures are deliberately NOT ended here — `no-worker` and `failed`
          leave the job for the reconciler, which is exactly what that path is
          for.
        */
        if (dispatch.dispatched === false && dispatch.reason === "refused") {
          console.error("[ai/webhook] worker REFUSED the finalization — ending the job", {
            jobId: job.id,
            status: dispatch.status,
            detail: dispatch.detail,
          });
          await failJob(job.id, subjectFromRow(job), feature.id, "FINALIZER_UNAVAILABLE", dispatch.detail);
        }
      });

      return NextResponse.json({ ok: true }, { status: 200 });
    }

    if (state.status === "failed") {
      return await failJob(job.id, subjectFromRow(job), feature.id, "PROCESSING_FAILED", state.detail);
    }

    if (state.status === "cancelled") {
      const updated = await transitionJob(job.id, ["queued", "processing"], "cancelled", {
        completed_at: new Date().toISOString(),
      });
      if (updated) {
        // A cancelled run still consumed provider time, but the member asked for
        // it to stop and got nothing — the slot goes back.
        await refund(subjectFromRow(job), feature.id);
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
  // 🔴 Null only if the row somehow has neither owner, which the check
  // constraint forbids. Typed nullable anyway: a refund credited to the wrong
  // subject is worse than one that is skipped and logged.
  subject: AiSubject | null,
  feature: AiFeature,
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
    await refund(subject, feature);
    /*
      The provider gave up on a job the member is probably no longer watching —
      this model runs for minutes, so a silent failure is indistinguishable
      from one still running. The refund is stated in the sentence because
      "it failed" alone reads as "and it cost me one of my two".
    */
    // A guest has nowhere to receive a push; they see it when they return.
    if (subject?.kind === "user") {
      await notifyAiCleanFailed({
        userId: subject.userId,
        jobId,
        message: aiErrorMessage(code === "PROVIDER_UNAVAILABLE" ? "PROVIDER_UNAVAILABLE" : "PROCESSING_FAILED"),
      });
    }
    console.error("[ai/webhook] failed", {
      jobId,
      subject: subject?.key ?? null,
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
async function refund(subject: AiSubject | null, feature: AiFeature) {
  const def = aiFeature(feature);
  if (!def || !subject) return;
  const entitlement = await getAiEntitlement(subject, def);
  await releaseAiUsage(subject, feature, entitlement.dailyLimit);
}
