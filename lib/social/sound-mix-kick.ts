import "server-only";

import { after } from "next/server";

import { hasWorker, WORKER_SECRET, WORKER_URL } from "@/lib/worker";

/** At most one kick per server instance in this window — the worker job itself also runs one at a time. */
const KICK_EVERY_MS = 60 * 1000;
let lastKick = 0;

/**
 * Asks the worker to give the reels waiting for their sound that sound (0308, server/services/sound-mix-service.ts).
 * Called by a publish that marked a reel; the request goes out AFTER the response (`after`), so publishing never waits
 * on it, and a refused or failed kick changes nothing — the next publish's kick picks the reel up too.
 */
export function kickSoundMix(): void {
  if (!hasWorker) return;
  const now = Date.now();
  if (now - lastKick < KICK_EVERY_MS) return;
  lastKick = now;
  const send = () =>
    fetch(`${WORKER_URL}/api/internal/sounds/mix`, {
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
    // outside a request (a script, a test, or already inside an after()): send now, never throw into the caller
    void send();
  }
}
