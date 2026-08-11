"use client";

import type { AttributionEvent } from "./attribution";

/**
 * Client-side attribution batching (Feature 15 · Part 4).
 *
 * "Minimal network requests" from the brief is a BATCHING decision, not a
 * compression one. A feed page can show two surfaced reposts and a member can
 * scroll past a dozen over a session; one request per card would be a request
 * per card. Events queue here and go up together.
 *
 * ── When the queue flushes ───────────────────────────────────────────────
 *  · `visibilitychange` → hidden, and `pagehide`. These are the only two
 *    events that reliably fire on mobile when an app is backgrounded or
 *    closed; `beforeunload` does not fire on iOS at all, so a queue that only
 *    listened for it would silently lose most of its data.
 *  · A short idle timer, so a long session still reports as it goes.
 *  · At a size cap, so the queue cannot grow without bound.
 *
 * `sendBeacon` on the unload paths — a `fetch` issued while the page is going
 * away is routinely cancelled, and this is telemetry: it must never be worth
 * delaying a navigation for.
 *
 * ── De-duplication happens here AND in the database ──────────────────────
 * The unique index on (repost, actor, event) is the real guarantee; this map
 * just avoids sending what will certainly be rejected. Scrolling a card in and
 * out of view repeatedly costs one row, once.
 *
 * ── What this never sends ────────────────────────────────────────────────
 * No actor id. The server takes that from the session — a client that could
 * name the actor could attribute reach to anyone.
 */

interface QueuedEvent {
  repostId: string;
  postId: string;
  event: AttributionEvent;
}

const queue: QueuedEvent[] = [];
const sent = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let listenersBound = false;

/** Beyond this the queue flushes immediately rather than waiting for idle. */
const MAX_QUEUE = 12;
const IDLE_MS = 8000;

function bindListeners() {
  if (listenersBound || typeof document === "undefined") return;
  listenersBound = true;
  const onHide = () => {
    if (document.visibilityState === "hidden") flush(true);
  };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", () => flush(true));
}

/**
 * Record that a repost caused something. Fire-and-forget, always safe to call.
 *
 * `repostId` is absent on an organic feed item — nothing to attribute — so the
 * call is a no-op rather than the caller having to check.
 */
export function attributeRepost(
  repostId: string | null | undefined,
  postId: string,
  event: AttributionEvent,
): void {
  if (!repostId) return;
  const key = `${repostId}:${event}`;
  if (sent.has(key)) return;
  sent.add(key);
  queue.push({ repostId, postId, event });
  bindListeners();

  if (queue.length >= MAX_QUEUE) {
    flush(false);
    return;
  }
  if (flushTimer === null) {
    flushTimer = setTimeout(() => flush(false), IDLE_MS);
  }
}

/** Send whatever is queued. `unloading` switches to sendBeacon. */
export function flush(unloading: boolean): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (queue.length === 0) return;
  const events = queue.splice(0, queue.length);
  const body = JSON.stringify({ events });

  try {
    if (unloading && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon("/api/reposts/attribution", new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch("/api/reposts/attribution", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      /* telemetry — a lost batch costs a number, never a feature */
    });
  } catch {
    /* never throw out of a telemetry call */
  }
}

/** Test seam: forget what has been sent this session. */
export function __resetAttributionForTests(): void {
  queue.length = 0;
  sent.clear();
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}
