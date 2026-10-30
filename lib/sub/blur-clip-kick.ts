import "server-only";

import { after } from "next/server";

import { hasWorker, WORKER_SECRET, WORKER_URL } from "@/lib/worker";

/** At most one kick per server instance in this window — the worker job itself also runs one at a time. */
const KICK_EVERY_MS = 10 * 60 * 1000;
let lastKick = 0;

/**
 * Asks the worker to make the blurred clips locked videos still lack (owner, 2026-10-29: every exclusive post autoplays
 * blurred to a non-subscriber). Called by a feed read that found a locked video with no clip; the request goes out AFTER
 * the response (`after`), so no reader ever waits on it, and a refused or failed kick changes nothing for them.
 */
export function kickBlurClips(): void {
  if (!hasWorker) return;
  const now = Date.now();
  if (now - lastKick < KICK_EVERY_MS) return;
  lastKick = now;
  const send = () =>
    fetch(`${WORKER_URL}/api/internal/sub/blur-clips`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-secret": WORKER_SECRET },
      body: "{}",
    }).then(
      () => undefined,
      () => undefined,
    );
  try {
    after(send);
  } catch {
    // outside a request (a script, a test): send now, never throw into the caller
    void send();
  }
}
