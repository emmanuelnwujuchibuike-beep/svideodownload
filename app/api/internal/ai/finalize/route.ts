import { NextResponse } from "next/server";
import { z } from "zod";

import { finalizeAICleanJob } from "@/server/services/ai-finalize-service";
import { WORKER_SECRET } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/*
  On the worker there is no real ceiling; this hint only applies if Vercel ever
  runs it, and it would fail there anyway for want of ffmpeg. Same shape as
  `/api/internal/store-media`, which does the same kind of work.
*/
export const maxDuration = 300;

/**
 * POST /api/internal/ai/finalize — WORKER ONLY.
 *
 * ── 🔴 THE ENTIRE REQUEST IS ONE UUID ────────────────────────────────────────
 *
 * No paths, no URLs, no codecs, no arguments, no user id. Everything the mux
 * needs is read from the `ai_jobs` row on the other side of this call, which
 * means there is no field here for a caller to influence what ffmpeg does. That
 * is a stronger property than validating a richer body would be: the dangerous
 * inputs are not rejected, they do not exist.
 *
 * Protected by the shared worker secret, the same gate
 * `/api/internal/store-media` uses. Without it, this endpoint would be a way
 * for anyone to make our machine download and transcode video on demand.
 *
 * ── Why it answers before it finishes ────────────────────────────────────────
 *
 * The caller is a Vercel webhook that must not be held open for minutes (see
 * lib/ai/finalize-dispatch.ts). This accepts the work, answers 202, and lets
 * the finalizer run to completion in the background — the job row is where the
 * outcome is reported, not this response.
 *
 * 🔴 No `after()` here, deliberately. That helper exists for a serverless
 * platform that would otherwise freeze the function the moment it responds.
 * This route only ever runs on a long-lived Node server, where the promise
 * simply continues; wrapping it would add a Vercel-shaped dependency to the one
 * file guaranteed never to run there.
 */
const schema = z.object({ jobId: z.string().uuid() }).strict();

export async function POST(request: Request) {
  /*
    ── 🔴 THE BUG THAT MEANT AI CLEAN HAD NEVER ONCE FINISHED ────────────────

    This read `!WORKER_SECRET || header !== WORKER_SECRET`, which 403s when the
    worker has NO secret configured. Every other internal route on the same
    worker does the opposite:

        rejectIfUnauthorizedWorker   if (hasWorker || !WORKER_SECRET) return null
        /api/internal/store-media    if (WORKER_SECRET && header !== …) → 403

    So on a worker without `WORKER_SECRET`, downloads kept working and this one
    endpoint refused every request, forever. Measured 2026-09-08 across all 17
    jobs ever created: 0 completed, 0 result paths, **0 that ever reached
    `finalizing`** — the status this route's service is what sets. The provider
    had genuinely succeeded; one job even had `provider_output_url` recorded in
    its metadata and was still failed hours later, by which time Replicate had
    expired the file.

    It now matches the rest of the codebase. One posture for every worker route
    is itself the fix: the odd one out was the one that was wrong, and having
    two rules is how it stayed wrong without anyone noticing.
  */
  if (WORKER_SECRET && request.headers.get("x-worker-secret") !== WORKER_SECRET) {
    // Identical answer for a missing secret and a wrong one. A route that is
    // more specific about which is a route that helps somebody guess.
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  if (!WORKER_SECRET) {
    /*
      Not a refusal — see above — but not silent either. An unsecured internal
      endpoint is a real exposure (it makes this machine download and transcode
      video on request), and the only reason to accept it is that refusing was
      strictly worse: it broke the feature completely while the operator had no
      way to see why.
    */
    console.warn(
      "[ai/finalize] WORKER_SECRET is not set on this worker — the finalize endpoint is UNAUTHENTICATED. Set it on both the worker and the frontend.",
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });

  const { jobId } = parsed.data;

  /*
    ── 🔴 THE OUTCOME USED TO BE THROWN AWAY ─────────────────────────────────

    This was `void finalizeAICleanJob(jobId).catch(…)`, on the reasoning that
    the finalizer writes its own outcome to the job row. It does — but ONLY
    after it claims the job. Every check before that claim (no such job, no
    provider output recorded, no source path, not claimable) returns a code
    that went straight into the void.

    Measured on production 2026-09-08: Replicate succeeded in 3.8 seconds, the
    output URL was recorded, the dispatcher reported `ok` — and the job sat in
    `processing` for ever with nothing, anywhere, saying why. The worker had
    accepted the work and quietly declined to do it.

    So: race the finalizer against a short budget. A small clip finishes the
    whole mux in a couple of seconds, so the common case now answers with its
    real outcome and the caller records it. Anything genuinely slow still gets
    the 202 and continues in the background exactly as before — the budget
    ends the WAIT, never the work.
  */
  const REPORT_BUDGET_MS = 6_000;

  const work = finalizeAICleanJob(jobId).catch((e) => {
    // Anything reaching here escaped the service's own try/catch, which would
    // be a bug in the service rather than a failed job. Logged loudly.
    console.error("[ai/finalize] escaped the service", { jobId, error: String(e) });
    return { ok: false as const, jobId, code: "AI_FINALIZATION_FAILED" as const, detail: String(e) };
  });

  const outcome = await Promise.race([
    work,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), REPORT_BUDGET_MS)),
  ]);

  if (outcome === null) {
    // Still working. The job row is where the result will appear.
    return NextResponse.json({ ok: true, accepted: true, pending: true }, { status: 202 });
  }

  /*
    Finished inside the budget, so say what happened. `detail` is operator-facing
    and never reaches a browser: this endpoint is reachable only by the frontend
    holding the worker secret, and the frontend logs it rather than forwarding it.
  */
  return NextResponse.json(
    {
      ok: outcome.ok,
      accepted: true,
      code: "code" in outcome ? outcome.code : null,
      detail: "detail" in outcome ? outcome.detail : null,
      skipped: "skipped" in outcome ? outcome.skipped : null,
    },
    { status: 200 },
  );
}
