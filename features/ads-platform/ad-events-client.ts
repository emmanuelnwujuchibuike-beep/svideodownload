"use client";

import { postIngest } from "@/lib/analytics/ingest";
import { IMPRESSION_RULE, type AdEventType } from "@/lib/ads-platform/catalog";

/**
 * Ad viewer events — batched, once each, straight to Postgres.
 *
 * Same transport as the analytics collector (lib/analytics/ingest.ts): a raw
 * keepalive `fetch` to `rpc/track_ad_events` on *.supabase.co. No Vercel
 * function, no Railway, no Observability event, no Realtime.
 *
 *   · ONE request per batch, not per event: a batch flushes at 20 events, 10 s
 *     after its first event, or when the page hides — whichever is first. A
 *     single timer exists only while something is queued.
 *   · ONCE per (view, type): each view mints one id per event type and reuses
 *     it, so a double-fired click is the same id and the database's
 *     `on conflict (event_id) do nothing` drops the copy. The view also refuses
 *     the second call locally, so the copy never even leaves the browser.
 *   · A failed batch goes back to the front of the queue for the next flush;
 *     a replay is harmless for the same reason.
 */

export interface AdView {
  campaignId: string;
  creativeId: string;
  placement: string;
  page: string;
  /** event type → the id minted for it (reused on every repeat) */
  readonly ids: Map<AdEventType, string>;
}

interface Row {
  id: string;
  c: string;
  cr: string;
  t: AdEventType;
  p: string;
  v: string | null;
}

const MAX_BATCH = 20;
const FLUSH_AFTER_MS = 10_000;

let queue: Row[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

function uuid(): string {
  return crypto.randomUUID();
}

function visitorId(): string | null {
  try {
    // the analytics visitor id (lib/analytics/client.ts VISITOR_KEY) — read, never minted here
    return localStorage.getItem("frenz_vid");
  } catch {
    return null;
  }
}

/** One per rendered ad. A rotation to the next ad is a NEW view. */
export function newAdView(input: { campaignId: string; creativeId: string; placement: string; page: string }): AdView {
  return { ...input, ids: new Map() };
}

/** Record an event for a view. Returns false when this view already sent it. */
export function trackAdEvent(view: AdView, type: AdEventType): boolean {
  if (view.ids.has(type)) return false;
  const id = uuid();
  view.ids.set(type, id);
  queue.push({ id, c: view.campaignId, cr: view.creativeId, t: type, p: view.page, v: visitorId() });
  listen();
  if (queue.length >= MAX_BATCH) void flushAdEvents();
  else timer ??= setTimeout(() => void flushAdEvents(), FLUSH_AFTER_MS);
  return true;
}

export async function flushAdEvents(unloading = false): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (queue.length === 0) return;
  const batch = queue.splice(0, MAX_BATCH);
  const ok = await postIngest("track_ad_events", { p_rows: batch }, unloading);
  if (!ok && !unloading) queue = [...batch, ...queue];
  if (queue.length > 0 && !unloading) timer ??= setTimeout(() => void flushAdEvents(), FLUSH_AFTER_MS);
}

function listen(): void {
  if (listening || typeof document === "undefined") return;
  listening = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushAdEvents(true);
  });
  window.addEventListener("pagehide", () => void flushAdEvents(true));
}

/**
 * The impression rule, on an element: `visible` when at least half of it is
 * in the viewport, `impression` when it STAYS so for one continuous second.
 * Downloading or mounting an ad is only `loaded` — never an impression.
 * Returns the disconnect function. One observer per element, no polling.
 */
export function observeImpression(el: Element, view: AdView): () => void {
  if (typeof IntersectionObserver === "undefined") return () => {};
  let hold: ReturnType<typeof setTimeout> | null = null;
  const io = new IntersectionObserver(
    ([entry]) => {
      const seen = !!entry && entry.isIntersecting && entry.intersectionRatio >= IMPRESSION_RULE.minVisibleRatio;
      if (seen) {
        trackAdEvent(view, "visible");
        hold ??= setTimeout(() => {
          trackAdEvent(view, "impression");
          io.disconnect();
        }, IMPRESSION_RULE.minVisibleMs);
      } else if (hold) {
        clearTimeout(hold);
        hold = null;
      }
    },
    { threshold: [IMPRESSION_RULE.minVisibleRatio] },
  );
  io.observe(el);
  return () => {
    if (hold) clearTimeout(hold);
    io.disconnect();
  };
}

/** Tests only. */
export function __adEventQueue(): readonly Row[] {
  return queue;
}
export function __resetAdEvents(): void {
  queue = [];
  if (timer) clearTimeout(timer);
  timer = null;
}
