import "server-only";

import { SITE_URL } from "@/lib/site";
import { WORKER_SECRET } from "@/lib/worker";

const DISPATCH_TIMEOUT_MS = 10_000;

export type NotifyDispatch = { dispatched: true } | { dispatched: false; detail: string };

function frontendUrl(): string {
  return (process.env.FRENZ_FRONTEND_URL?.trim() || SITE_URL).replace(/\/$/, "");
}

/**
 * Ask the FRONTEND to announce a finished job. Called from a process without
 * push keys (the worker) — see lib/ai/notify.ts. The same direction as
 * `dispatchProviderSubmit`: the worker knows the frontend's address and the
 * shared secret; the frontend holds the VAPID keys and the claim.
 */
export async function dispatchAiNotification(jobId: string): Promise<NotifyDispatch> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISPATCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${frontendUrl()}/api/internal/ai/notify`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", ...(WORKER_SECRET ? { "x-worker-secret": WORKER_SECRET } : {}) },
      body: JSON.stringify({ jobId }),
    });
    if (!res.ok) return { dispatched: false, detail: `frontend answered ${res.status}` };
    const body = (await res.json().catch(() => null)) as { ok?: boolean; detail?: string } | null;
    if (body && body.ok === false) return { dispatched: false, detail: body.detail ?? "frontend declined" };
    return { dispatched: true };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return { dispatched: false, detail: aborted ? `frontend did not answer within ${DISPATCH_TIMEOUT_MS}ms` : String(e) };
  } finally {
    clearTimeout(timer);
  }
}
