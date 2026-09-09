import "server-only";

import { hasWorker, WORKER_SECRET, WORKER_URL } from "@/lib/worker";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ASKING THE WORKER TO GO AND FETCH THE MEMBER'S VIDEO (Part 6)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The mirror of `finalize-dispatch.ts`, at the other end of the job: that one
 * hands a finished prediction to the machine with ffmpeg, this one hands a
 * pasted link to the machine with yt-dlp. Same two roles, same shared secret,
 * same reason — Vercel has neither binary and no filesystem worth the name.
 *
 * ── 🔴 THE JOB ID IS THE ENTIRE PAYLOAD ─────────────────────────────────────
 *
 * No url, no format, no path, no owner. The worker re-reads all of it from
 * `ai_jobs`, where the address was written only after `validateAiSourceUrl`
 * accepted it. That is what makes this message harmless if it were ever forged:
 * the worst a caller with the secret could do is make us re-fetch a link a
 * member already asked us to fetch.
 *
 * A url in this body would be the whole SSRF hole reopened at the back door —
 * an internal endpoint that fetches whatever it is told, one leaked secret away
 * from being a proxy into our own network.
 *
 * ── It must not wait ────────────────────────────────────────────────────────
 *
 * An extraction plus a download is tens of seconds to minutes. The caller is a
 * member's `/start` request, which has to answer now so the progress screen can
 * appear. So this dispatches and returns; the outcome is written to the job row
 * by the worker, and the member's poll is what surfaces it.
 */

/** Long enough for the worker to ACCEPT the work, never long enough to do it. */
const DISPATCH_TIMEOUT_MS = 8_000;

export type AcquireDispatch =
  | { dispatched: true }
  | { dispatched: false; reason: "no-worker" | "refused" | "failed"; detail: string };

export async function dispatchAcquisition(jobId: string): Promise<AcquireDispatch> {
  if (!hasWorker) {
    return { dispatched: false, reason: "no-worker", detail: "no DOWNLOAD_WORKER_URL is configured" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISPATCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${WORKER_URL}/api/internal/ai/acquire`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(WORKER_SECRET ? { "x-worker-secret": WORKER_SECRET } : {}),
      },
      body: JSON.stringify({ jobId }),
    });

    if (!res.ok) {
      /*
        🔴 PERMANENT vs TRANSIENT, and the caller needs the difference.

        403 means the two sides disagree about the shared secret; 404 means the
        route is not deployed on the worker. Neither gets better on a retry, and
        this project has already lost every AI Clean job once to a 403 that was
        reported as a successful handoff. The caller ENDS the job on `refused`
        rather than leaving somebody watching a spinner for a misconfiguration
        only an operator can clear.
      */
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        return {
          dispatched: false,
          reason: "refused",
          detail: `worker answered ${res.status} — check WORKER_SECRET on BOTH sides, and that /api/internal/ai/acquire is deployed`,
        };
      }
      return { dispatched: false, reason: "failed", detail: `worker answered ${res.status}` };
    }

    /*
      Read what it actually said. A 2xx is not automatically a hand-off: the
      worker answers 200 with `ok:false` when it looks at the job and declines
      (wrong status, no url, already claimed). Treating that as success is how a
      job gets recorded as dispatched and then never moves — the exact failure
      the finalize dispatch had to be taught to catch.
    */
    try {
      const body = (await res.json()) as {
        ok?: boolean;
        accepted?: boolean;
        code?: string | null;
        detail?: string | null;
      };
      if (body?.accepted) return { dispatched: true };
      if (body && body.ok === false) {
        return {
          dispatched: false,
          reason: "refused",
          detail: `worker declined: ${body.code ?? "unknown"}${body.detail ? ` — ${body.detail}` : ""}`,
        };
      }
    } catch {
      // A 2xx with an unreadable body is still a hand-off.
    }

    return { dispatched: true };
  } catch (e) {
    /*
      🔴 A TIMEOUT IS A FAILURE, NOT A BUSY WORKER.

      The acquire route validates and answers in milliseconds, deliberately —
      it starts the fetch WITHOUT awaiting it. So an abort here means the worker
      did not answer at all: unreachable host, wrong URL, DNS failure, a cold
      container. Every one of those is a failed handoff, and calling it success
      is what left jobs in `processing` with no error recorded last time.
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
