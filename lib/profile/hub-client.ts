"use client";

import type { HubKey } from "@/lib/profile/hub";
import type { HubPayload } from "@/lib/profile/hub-data";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  HUB READS ON THE DEVICE — a queue that prefetches one section at a time
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-13: "all modal prefetch as they scroll and they shouldn't
 * prefetch at once, any that haven't cached or prefetched should show a
 * strip loader."
 *
 * Three layers, cheapest first:
 *
 *   memory        this page's own answers, and every request in flight, so a
 *                 button that is tapped while its prefetch is running waits
 *                 on THAT request rather than starting a second;
 *   session       `sessionStorage`, five minutes, keyed by handle and key, so
 *                 a back-swipe to the profile reopens a section instantly;
 *   network       GET /api/profile/<handle>/hub/<key>.
 *
 * ── The queue ───────────────────────────────────────────────────────────────
 *
 * Buttons enqueue their key as they scroll into view. ONE request is in
 * flight at a time and the next waits for an idle moment, so a hub of
 * fifteen buttons scrolling past is fifteen small reads spread over a few
 * seconds, never fifteen concurrent lambdas racing the grid's images. A tap
 * jumps the queue: `readHubSection` starts its request immediately and the
 * drain simply finds it done.
 */

const TTL_MS = 5 * 60 * 1000;
const memory = new Map<string, HubPayload>();
const inflight = new Map<string, Promise<HubPayload | null>>();
const queue: { handle: string; key: HubKey }[] = [];
let draining = false;

function id(handle: string, key: HubKey): string {
  return `${handle.toLowerCase()}:${key}`;
}

function sessionRead(k: string): HubPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(`frenz_hub:${k}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: unknown; value?: HubPayload };
    if (typeof parsed.at !== "number" || !parsed.value) return null;
    if (Date.now() - parsed.at > TTL_MS) {
      window.sessionStorage.removeItem(`frenz_hub:${k}`);
      return null;
    }
    return parsed.value;
  } catch {
    return null;
  }
}

function sessionWrite(k: string, value: HubPayload): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(`frenz_hub:${k}`, JSON.stringify({ at: Date.now(), value }));
  } catch {
    /* quota or private mode — memory still has it for this page */
  }
}

/** What is already on the device, without asking the network. */
export function peekHubSection(handle: string, key: HubKey): HubPayload | null {
  const k = id(handle, key);
  const m = memory.get(k);
  if (m) return m;
  const s = sessionRead(k);
  if (s) memory.set(k, s);
  return s;
}

/** Read a section now — from the device if it is there, else the network. Null on refusal or failure. */
export function readHubSection(handle: string, key: HubKey): Promise<HubPayload | null> {
  const k = id(handle, key);
  const known = peekHubSection(handle, key);
  if (known) return Promise.resolve(known);
  const running = inflight.get(k);
  if (running) return running;
  const p = (async () => {
    try {
      const res = await fetch(`/api/profile/${encodeURIComponent(handle)}/hub/${key}`, { credentials: "same-origin" });
      if (!res.ok) return null;
      const value = (await res.json()) as HubPayload;
      memory.set(k, value);
      sessionWrite(k, value);
      return value;
    } catch {
      return null;
    } finally {
      inflight.delete(k);
    }
  })();
  inflight.set(k, p);
  return p;
}

/** Ask for a section to be fetched soon, after whatever is already queued. */
export function prefetchHubSection(handle: string, key: HubKey): void {
  const k = id(handle, key);
  if (memory.has(k) || inflight.has(k) || queue.some((q) => id(q.handle, q.key) === k)) return;
  if (sessionRead(k)) return;
  queue.push({ handle, key });
  void drain();
}

/** Forget a section so its next read goes to the network — after a write inside it. */
export function invalidateHubSection(handle: string, key: HubKey): void {
  const k = id(handle, key);
  memory.delete(k);
  try {
    window.sessionStorage.removeItem(`frenz_hub:${k}`);
  } catch {
    /* nothing to forget */
  }
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      const { handle, key } = queue.shift()!;
      const k = id(handle, key);
      if (memory.has(k) || inflight.has(k)) continue;
      await readHubSection(handle, key);
      // Breathe between reads: an idle callback where the browser has one,
      // a short beat where it does not (Safari), so a scroll stays smooth.
      await new Promise<void>((resolve) => {
        const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
        if (typeof w.requestIdleCallback === "function") w.requestIdleCallback(() => resolve(), { timeout: 400 });
        else w.setTimeout(resolve, 150);
      });
    }
  } finally {
    draining = false;
  }
}
