import "server-only";

import { hasWorker, WORKER_SECRET, WORKER_URL } from "@/lib/worker";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Handing a finished prediction to the machine that can finish the job
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The webhook runs on Vercel, where there is no ffmpeg and no filesystem worth
 * the name. The mux runs on the Docker worker, which has both. This is the one
 * line between them.
 *
 * ── 🔴 THE WEBHOOK MUST NOT WAIT ─────────────────────────────────────────────
 *
 * A mux takes seconds to minutes. A webhook that waited for it would hold a
 * serverless function open for the whole of it, hit the platform ceiling, and
 * return a non-2xx — which makes Replicate retry, which starts the work again.
 * So this fires and returns: a short connect timeout, no reading of the
 * response body, and the outcome is written to the job row by the worker rather
 * than reported back through this call.
 *
 * The job id is the entire payload. The worker re-reads everything else from
 * the database, so this message cannot carry a path, a URL, a codec or a user.
 */

/** Long enough for the worker to ACCEPT the work, never long enough to do it. */
const DISPATCH_TIMEOUT_MS = 8_000;

export type DispatchResult =
  | { dispatched: true }
  /** No worker is configured — the caller degrades rather than losing the job. */
  | { dispatched: false; reason: "no-worker" }
  /**
   * The worker answered, and refused.
   *
   * 🔴 Its own reason because it is PERMANENT and retrying cannot fix it. A 403
   * means the two sides disagree about the shared secret; a 404 means the route
   * is not deployed. Both stay true on every retry, so a caller that treats
   * them like a network blip leaves the member watching a spinner for a
   * misconfiguration only an operator can clear.
   *
   * This is exactly what happened: every AI Clean job ever created died here,
   * unreported, because the worker's own guard 403'd when it had no secret set.
   */
  | { dispatched: false; reason: "refused"; status: number; detail: string }
  | { dispatched: false; reason: "failed"; detail: string };

/**
 * Ask the worker to finalize a job.
 *
 * Never throws: a failed dispatch is a job left in `processing`, which the
 * recovery sweep can pick up, and it must not be allowed to turn the webhook
 * into a 500 that makes Replicate redeliver.
 */
export async function dispatchFinalization(jobId: string): Promise<DispatchResult> {
  if (!hasWorker) return { dispatched: false, reason: "no-worker" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISPATCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${WORKER_URL}/api/internal/ai/finalize`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        // The same shared secret every other internal worker call uses. Without
        // it the worker refuses, which is what stops this endpoint being a way
        // for anybody to make our machine do expensive work.
        ...(WORKER_SECRET ? { "x-worker-secret": WORKER_SECRET } : {}),
      },
      body: JSON.stringify({ jobId }),
    });

    if (!res.ok) {
      /*
        403 = the secret does not match (or one side has none). 404 = the route
        is not deployed on the worker. 401 likewise. None of these get better by
        being retried, and the caller needs to know that so it can END the job
        with an honest error rather than leave it processing forever.
      */
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        return {
          dispatched: false,
          reason: "refused",
          status: res.status,
          detail: `worker answered ${res.status} — check WORKER_SECRET on BOTH the worker and the frontend, and that /api/internal/ai/finalize is deployed`,
        };
      }
      return { dispatched: false, reason: "failed", detail: `worker answered ${res.status}` };
    }
    return { dispatched: true };
  } catch (e) {
    /*
      ── 🔴 A TIMEOUT IS A FAILURE. IT USED TO BE REPORTED AS SUCCESS. ───────

      This read: "an abort here is the EXPECTED shape when the worker accepts
      the job and starts working before answering". That is simply not how the
      worker behaves. `/api/internal/ai/finalize` validates the body, starts
      `finalizeAICleanJob` WITHOUT awaiting it, and returns 202 in
      milliseconds — deliberately, so this call never waits on a mux.

      So an abort does not mean "busy working". It means the worker did not
      answer in eight seconds: unreachable host, wrong URL, DNS failure, a cold
      container, a hung TLS handshake. Every one of those is a failed handoff.

      Calling it success was the worst possible shape for this bug. The job was
      left in `processing` with NO error recorded, nothing retried, and a log
      line claiming the dispatch had worked — which is precisely what a stuck
      job looks like from the outside, and why this took so long to find.
    */
    const aborted = e instanceof Error && e.name === "AbortError";
    return {
      dispatched: false,
      reason: "failed",
      detail: aborted
        ? `worker did not answer within ${DISPATCH_TIMEOUT_MS}ms — check DOWNLOAD_WORKER_URL is reachable from Vercel`
        : String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}
