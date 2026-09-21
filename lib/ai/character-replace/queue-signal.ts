import "server-only";

import { after } from "next/server";

import { SITE_URL } from "@/lib/site";
import { hasWorker, WORKER_SECRET } from "@/lib/worker";

/**
 * "A slot just freed — look at this member's line." The one call every undo
 * and every completion makes (0166), kept apart from the pump itself so
 * lib/ai/funding.ts (which the pump imports) can import THIS without a cycle.
 *
 * On the FRONTEND the pump runs here, after the response when there is one
 * (`after` — the platform's way to keep working past a returned response;
 * outside a request scope, in a cron's own await chain for example, it
 * simply runs). On the WORKER it is one HTTP request to the frontend — the
 * same worker → frontend hop as the submit and the notification. Never
 * awaited by the caller and never allowed to throw into it: a slot that
 * frees is a fact the reconcile sweep will also act on within ten minutes.
 */

const REQUEST_TIMEOUT_MS = 10_000;

function frontendUrl(): string {
  return (process.env.FRENZ_FRONTEND_URL?.trim() || SITE_URL).replace(/\/$/, "");
}

async function dispatchQueuePump(userId: string | null, reason: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${frontendUrl()}/api/internal/ai/queue`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", ...(WORKER_SECRET ? { "x-worker-secret": WORKER_SECRET } : {}) },
      body: JSON.stringify({ userId, reason }),
    });
    if (!res.ok) console.warn("[cr/queue] frontend refused the pump request", { status: res.status, reason });
  } catch (e) {
    console.warn("[cr/queue] pump request failed — the sweep will pump", { reason, error: String(e).slice(0, 200) });
  } finally {
    clearTimeout(timer);
  }
}

export function requestQueuePump(userId: string | null, reason: string): void {
  const run = async () => {
    try {
      const { pumpCharacterReplaceQueue } = await import("@/lib/ai/character-replace/queue");
      await pumpCharacterReplaceQueue({ userId, reason });
    } catch (e) {
      console.error("[cr/queue] pump threw", { reason, error: String(e).slice(0, 300) });
    }
  };
  if (!hasWorker) {
    void dispatchQueuePump(userId, reason);
    return;
  }
  try {
    after(run);
  } catch {
    void run();
  }
}
