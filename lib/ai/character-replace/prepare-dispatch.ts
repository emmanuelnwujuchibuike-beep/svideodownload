import "server-only";

import { hasWorker, WORKER_SECRET, WORKER_URL } from "@/lib/worker";

const DISPATCH_TIMEOUT_MS = 8_000;

export type PrepareDispatch =
  | { dispatched: true }
  | { dispatched: false; reason: "no-worker" | "refused" | "failed"; detail: string };

/**
 * Hand a Character Replace job to the worker for trimming (Part 4, §5).
 * The same contract as `dispatchAcquisition`: 401/403/404 are PERMANENT
 * (the caller ends the job with a refund rather than leaving a spinner on
 * a misconfiguration), anything else is transient, and a 2xx is read for
 * `accepted` rather than taken on faith.
 */
export async function dispatchPreparation(jobId: string): Promise<PrepareDispatch> {
  if (!hasWorker) return { dispatched: false, reason: "no-worker", detail: "no DOWNLOAD_WORKER_URL is configured" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISPATCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${WORKER_URL}/api/internal/ai/prepare`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", ...(WORKER_SECRET ? { "x-worker-secret": WORKER_SECRET } : {}) },
      body: JSON.stringify({ jobId }),
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        return { dispatched: false, reason: "refused", detail: `worker answered ${res.status} — check WORKER_SECRET on BOTH sides, and that /api/internal/ai/prepare is deployed` };
      }
      return { dispatched: false, reason: "failed", detail: `worker answered ${res.status}` };
    }
    try {
      const body = (await res.json()) as { ok?: boolean; accepted?: boolean; code?: string | null; detail?: string | null };
      if (body?.accepted) return { dispatched: true };
      if (body && body.ok === false) {
        return { dispatched: false, reason: "refused", detail: `worker declined: ${body.code ?? "unknown"}${body.detail ? ` — ${body.detail}` : ""}` };
      }
    } catch {
      /* an unreadable body is treated as accepted below */
    }
    return { dispatched: true };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return { dispatched: false, reason: "failed", detail: aborted ? `worker did not answer within ${DISPATCH_TIMEOUT_MS}ms` : String(e) };
  } finally {
    clearTimeout(timer);
  }
}
