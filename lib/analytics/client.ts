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

/**
 * The current session id, opening a new one after 30 minutes of inactivity.
 *
 * 30 minutes is the GA/Plausible/Adobe convention, and the reason to match it is
 * comparability rather than correctness — any threshold is arbitrary, but a
 * non-standard one makes every session-derived number incomparable to the tools
 * the owner will sanity-check against.
 *
 * ── The two-tab race (owner audit, 2026-08-09) ───────────────────────────────
 * localStorage is shared across tabs but offers no lock. Two tabs waking from
 * the same expired session both read the old timestamp, both decide the session
 * has ended, and both mint a DIFFERENT session id — so one returning visitor
 * became two sessions, and both tabs then wrote conflicting ids for the rest of
 * the visit.
 *
 * The re-read below closes the window to a single storage round-trip: whichever
 * tab writes second immediately sees the other's id and adopts it, rather than
 * keeping the one it just generated. It is not a mutex and cannot be — but the
 * remaining race is two writes landing in the same microtask, which is far
 * narrower than the multi-second window it replaces.
 *
 * The count itself is now belt-and-braces: `analytics_traffic_totals` counts
 * DISTINCT session ids rather than `session_start` events, so even a session
 * that manages to announce itself twice is one session.
 */
function ensureSession(): { id: string; started: boolean } {
  const now = Date.now();
  const id = lsGet(SESSION_KEY);
  const ts = Number(lsGet(SESSION_TS_KEY)) || 0;

  if (id && now - ts <= SESSION_WINDOW_MS) {
    lsSet(SESSION_TS_KEY, String(now));
    return { id, started: false };
  }

  const minted = uuid();
  lsSet(SESSION_KEY, minted);
  lsSet(SESSION_TS_KEY, String(now));
  // Did another tab write one between our read and our write? Adopt theirs —
  // whoever loses the race defers, so both tabs converge on one id.
  const settled = lsGet(SESSION_KEY) ?? minted;
  return { id: settled, started: settled === minted };
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

/* ───────────────────────── time on page / bounce rate ─────────────────────── */

/**
 * Dwell measurement for the page currently open.
 *
 * ── Why a measured exit event rather than a derived estimate ─────────────────
 * "Time on page" is usually derived as `next event time − this event time`,
 * which cannot see the LAST page of a session at all and scores it zero. Since
 * bouncing sessions are entirely made of last pages, that estimate reports the
 * shortest visits as the longest-engaged, and the error grows with bounce rate.
 * A real `page_exit` carrying the dwell it actually observed has neither
 * problem.
 *
 * Only time the tab is VISIBLE is counted. A tab left open in the background for
 * six hours did not hold anyone's attention for six hours, and counting it would
 * make the average meaningless. The accumulator is paused on `visibilitychange`
 * and resumed when the tab comes back — so 30 seconds of reading, an hour in
 * another tab, then 30 more seconds is one minute, which is the truth.
 *
 * The server additionally clamps a single dwell to 30 minutes (migration 0115),
 * because a device that sleeps mid-page can still report an implausible span.
 */
let dwellPath: string | null = null;
let dwellVisibleSince = 0;
let dwellAccrued = 0;

function dwellNow(): number {
  const live = dwellVisibleSince > 0 ? Date.now() - dwellVisibleSince : 0;
  return dwellAccrued + live;
}

/** Ends the current page's dwell and queues the `page_exit` that carries it. */
function closeDwell(): void {
  if (!dwellPath) return;
  const ms = dwellNow();
  const path = dwellPath;
  dwellPath = null;
  dwellVisibleSince = 0;
  dwellAccrued = 0;
  // Sub-second dwell is a bounce-through or a redirect, not a read. Sending it
  // would drag the average down with time nobody spent.
  if (ms < 1000) return;
  if (!enabled()) return;
  const { id: sessionId } = ensureSession();
  const ev = build("page_exit", sessionId, { dwellMs: Math.round(ms), path });
  // Stamp the path the dwell BELONGS to — `build` reads location, which may
  // already be the next page by the time an exit fires on a client navigation.
  ev.path = path;
  queue.push(ev);
  scheduleFlush();
}

function startDwell(path: string): void {
  dwellPath = path;
  dwellAccrued = 0;
  dwellVisibleSince = hasWindow && document.visibilityState === "visible" ? Date.now() : 0;
}

export function trackPageView(): void {
  const path = hasWindow ? window.location.pathname : "";
  /*
    Close the previous page BEFORE opening the next, so a client navigation
    produces exactly one exit for the page being left. Re-firing for the same
    path is ignored: React can re-run an effect (Strict Mode, a re-mount) without
    the visitor having gone anywhere, and that must not manufacture a page view.
  */
  if (dwellPath === path) return;
  closeDwell();
  startDwell(path);
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
    /**
     * The page the download came from, and its title.
     *
     * Sent on `requested` only — it is the same for every later stage, and
     * repeating it would store the same URL four times per download. The admin
     * download log joins it back from this first event (migration 0115,
     * `analytics_download_log`); it is what makes the owner's "see the details
     * and link" possible at all, since `analytics_downloads` has no URL column.
     */
    sourceUrl?: string | null;
    title?: string | null;
    /**
     * Total attempts including the successful one. Sent on `completed` only —
     * it is what lets the server tell a first-time success from a download that
     * needed retrying, which is the difference the admin retry-success alert
     * exists to report (see lib/analytics/retry-success-alert.ts).
     */
    attempts?: number | null;
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
  window.addEventListener("pagehide", () => {
    closeDwell(); // the last page of a session reports its real time, not zero
    void flush(true);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      // Pause the dwell clock — background time is not attention.
      if (dwellVisibleSince > 0) {
        dwellAccrued += Date.now() - dwellVisibleSince;
        dwellVisibleSince = 0;
      }
      void flush(true);
    } else if (dwellPath && dwellVisibleSince === 0) {
      dwellVisibleSince = Date.now();
    }
  });
}
