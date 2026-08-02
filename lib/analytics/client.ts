"use client";

import type { AnalyticsEventInput, AnalyticsEventType, DownloadStatus } from "./types";

/**
 * Enterprise Analytics — the client collector (Phase 1).
 *
 * Generates the stable IDs (a persistent Visitor ID, a rolling Session ID), stamps
 * each event with its own UUID (dedup key), batches events, and flushes them to the
 * collect endpoint — with a `sendBeacon` on page-hide so nothing is lost on exit.
 * Every browser API is guarded, so importing this on the server is a harmless no-op.
 */

const VISITOR_KEY = "frenz_vid";
const SESSION_KEY = "frenz_sid";
const SESSION_TS_KEY = "frenz_sid_ts";
const OPT_OUT_KEY = "frenz_analytics_off";
const SESSION_WINDOW_MS = 30 * 60 * 1000; // 30-minute inactivity window
const FLUSH_DEBOUNCE_MS = 3000;
const MAX_BATCH = 12;
const ENDPOINT = "/api/analytics/collect";

const hasWindow = typeof window !== "undefined";

function uuid(): string {
  try {
    if (hasWindow && window.crypto?.randomUUID) return window.crypto.randomUUID();
  } catch {
    /* fall through */
  }
  // RFC4122-ish fallback for older browsers.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked — events for this load just won't carry a stable id */
  }
}

function enabled(): boolean {
  if (!hasWindow) return false;
  return lsGet(OPT_OUT_KEY) !== "1";
}

function getVisitorId(): string {
  let id = lsGet(VISITOR_KEY);
  if (!id) {
    id = uuid();
    lsSet(VISITOR_KEY, id);
  }
  return id;
}

/** Returns the current session id, opening a new one after 30 min of inactivity. */
function ensureSession(): { id: string; started: boolean } {
  const now = Date.now();
  let id = lsGet(SESSION_KEY);
  const ts = Number(lsGet(SESSION_TS_KEY)) || 0;
  let started = false;
  if (!id || now - ts > SESSION_WINDOW_MS) {
    id = uuid();
    lsSet(SESSION_KEY, id);
    started = true;
  }
  lsSet(SESSION_TS_KEY, String(now));
  return { id, started };
}

let queue: AnalyticsEventInput[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function build(type: AnalyticsEventType, sessionId: string, props?: Record<string, unknown>, downloadId?: string | null): AnalyticsEventInput {
  return {
    eventId: uuid(),
    type,
    visitorId: getVisitorId(),
    sessionId,
    occurredAt: Date.now(),
    path: hasWindow ? window.location.pathname : null,
    referrer: hasWindow ? document.referrer || null : null,
    downloadId: downloadId ?? null,
    properties: props ?? {},
  };
}

function scheduleFlush(): void {
  if (queue.length >= MAX_BATCH) {
    void flush();
    return;
  }
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_DEBOUNCE_MS);
}

async function flush(useBeacon = false): Promise<void> {
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const body = JSON.stringify({ events: batch });
  try {
    if (useBeacon && hasWindow && navigator.sendBeacon) {
      const ok = navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
      if (!ok) queue.unshift(...batch);
      return;
    }
    const res = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true });
    if (!res.ok) queue.unshift(...batch); // server hiccup — retry on the next flush
  } catch {
    queue.unshift(...batch); // offline — retry on the next flush
  }
}

/** Core: enqueue an event (opening a session_start first if a new session began). */
export function track(type: AnalyticsEventType, props?: Record<string, unknown>, downloadId?: string | null): void {
  if (!enabled()) return;
  const { id: sessionId, started } = ensureSession();
  if (started && type !== "session_start") queue.push(build("session_start", sessionId));
  queue.push(build(type, sessionId, props, downloadId));
  scheduleFlush();
}

export function trackPageView(): void {
  track("page_view");
}

/** A download lifecycle event. `downloadId` links every stage of one download so a
 *  refresh or retry never double-counts (server dedups on it). */
export function trackDownload(
  status: DownloadStatus,
  info: {
    downloadId: string;
    platform?: string | null;
    mediaKind?: string | null;
    quality?: string | null;
    fileSize?: number | null;
    durationMs?: number | null;
    errorReason?: string | null;
    retryOf?: string | null;
  },
): void {
  const type: AnalyticsEventType =
    status === "requested" ? "download_requested"
    : status === "started" ? "download_started"
    : status === "preparing" ? "download_preparing"
    : status === "completed" ? "download_completed"
    : status === "failed" ? "download_failed"
    : status === "cancelled" ? "download_cancelled"
    : "custom";
  const { downloadId, ...rest } = info;
  track(type, { status, ...rest }, downloadId);
}

// Flush on the way out so queued events aren't lost. `pagehide` fires on both real
// unloads and iOS bfcache freezes; a hidden `visibilitychange` covers backgrounding.
if (hasWindow) {
  window.addEventListener("pagehide", () => void flush(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush(true);
  });
}
