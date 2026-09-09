import "server-only";

import { WORKER_SECRET } from "@/lib/worker";
import { SITE_URL } from "@/lib/site";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE WORKER CALLING BACK — "the video is stored, submit it" (Part 6)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The only message in this system that travels worker → frontend. Everything
 * else goes the other way.
 *
 * ── 🔴 WHY THE WORKER DOES NOT JUST SUBMIT IT ITSELF ────────────────────────
 *
 * It could: the worker runs the same image and could import `submitJobToProvider`
 * directly. That was the first design, and it was rejected for one reason —
 * it would put `REPLICATE_API_TOKEN` on a second host.
 *
 * Today every provider credential lives on Vercel and nowhere else. Copying a
 * payment credential onto the Docker worker to save one HTTP hop is a bad
 * trade, and it would add the failure mode this project has been bitten by
 * twice: a feature that silently does nothing until somebody remembers to set
 * an environment variable on the machine nobody redeploys.
 *
 * So the split is: the worker holds the storage key and the binaries, the
 * frontend holds the provider credentials, and this is the one line between
 * them. Part 6 therefore needs ZERO new environment variables anywhere.
 *
 * ── The address it calls ────────────────────────────────────────────────────
 *
 * `SITE_URL`, which already resolves to the production frontend and is what
 * `notifyAiCleanFinished` builds push links from. `FRENZ_FRONTEND_URL`
 * overrides it for the case where the worker should talk to a preview deploy —
 * optional, so nothing breaks when it is unset.
 *
 * ── This one DOES wait ──────────────────────────────────────────────────────
 *
 * Unlike the two dispatches, submitting a prediction is a single fast API call
 * and the worker has nothing else to do until it knows the answer. Waiting
 * means the worker can fail the job honestly and refund when the provider
 * refuses, instead of leaving a row in `acquiring` with a stored video and
 * nothing coming.
 */

const SUBMIT_TIMEOUT_MS = 45_000;

function frontendUrl(): string {
  return (process.env.FRENZ_FRONTEND_URL?.trim() || SITE_URL).replace(/\/$/, "");
}

export type SubmitDispatch =
  | { submitted: true }
  | { submitted: false; reason: "refused" | "failed"; detail: string };

/** Ask the frontend to submit an acquired job to the provider. */
export async function dispatchProviderSubmit(jobId: string): Promise<SubmitDispatch> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);
  try {
    const res = await fetch(`${frontendUrl()}/api/internal/ai/submit`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        // The same shared secret both other internal calls use. Without it this
        // endpoint would let anyone spend the owner's provider credit.
        ...(WORKER_SECRET ? { "x-worker-secret": WORKER_SECRET } : {}),
      },
      // 🔴 One uuid. No url, no model, no engine — see acquire-dispatch.ts.
      body: JSON.stringify({ jobId }),
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        return {
          submitted: false,
          reason: "refused",
          detail: `frontend answered ${res.status} — check WORKER_SECRET on both sides and that /api/internal/ai/submit is deployed`,
        };
      }
      return { submitted: false, reason: "failed", detail: `frontend answered ${res.status}` };
    }

    try {
      const body = (await res.json()) as { ok?: boolean; code?: string | null; detail?: string | null };
      if (body && body.ok === false) {
        return {
          submitted: false,
          reason: "refused",
          detail: `frontend declined: ${body.code ?? "unknown"}${body.detail ? ` — ${body.detail}` : ""}`,
        };
      }
    } catch {
      /* a 2xx with an unreadable body is still a submission */
    }

    return { submitted: true };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return {
      submitted: false,
      reason: "failed",
      detail: aborted ? `frontend did not answer within ${SUBMIT_TIMEOUT_MS}ms` : String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}
