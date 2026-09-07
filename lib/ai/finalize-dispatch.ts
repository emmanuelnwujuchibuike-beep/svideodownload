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
      return { dispatched: false, reason: "failed", detail: `worker answered ${res.status}` };
    }
    return { dispatched: true };
  } catch (e) {
    // An abort here is the EXPECTED shape when the worker accepts the job and
    // starts working before answering — it is not a failure of the dispatch.
    const aborted = e instanceof Error && e.name === "AbortError";
    return aborted ? { dispatched: true } : { dispatched: false, reason: "failed", detail: String(e) };
  } finally {
    clearTimeout(timer);
  }
}
