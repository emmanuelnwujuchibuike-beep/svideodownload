"use client";

import { featureOf } from "./features";
import { postIngest, primeIdentity } from "./ingest";
import type { AnalyticsEventInput, AnalyticsEventType, DownloadStatus } from "./types";

/**
 * Enterprise Analytics — the client collector (Phase 1).
 *
 * Generates the stable IDs (a persistent Visitor ID, a rolling Session ID), stamps
 * each event with its own UUID (dedup key), batches events, and flushes them —
 * with a keepalive write on page-hide so nothing is lost on exit. Every browser API
 * is guarded, so importing this on the server is a harmless no-op.
 *
 * ── 🔴 THE FLUSH NO LONGER GOES THROUGH VERCEL (2026-09-27) ─────────────────
 *
 * Owner: "reduce Vercel Observability event usage/cost." Batches went to
 * `/api/analytics/collect`, a Node function whose only job was to forward rows to
 * Supabase — 22,121 invocations' worth in seven days, each also producing a
 * request log entry, and request logs are what the meter counts.
 *
 * They now go straight to `track_events` on Postgres (see ./ingest). Everything
 * else about this file — the ids, the 3s debounce, the 12-event batch, the
 * re-queue on failure, the dwell accounting, the opt-out — is unchanged, because
 * none of it was the problem.
 *
 * The collect route survives in ONE narrow role: the admin alerts on a bad
 * download outcome, which need server-side push and email. See `reportOutcome`.
 */

const VISITOR_KEY = "frenz_vid";
const SESSION_KEY = "frenz_sid";
const SESSION_TS_KEY = "frenz_sid_ts";
const OPT_OUT_KEY = "frenz_analytics_off";
const SESSION_WINDOW_MS = 30 * 60 * 1000; // 30-minute inactivity window
const FLUSH_DEBOUNCE_MS = 3000;
const MAX_BATCH = 12;
/*
  The alerts-only remnant of the old ingest endpoint. Called for terminal
  download events ONLY — roughly 3.7% of events by volume — because a failed
  download has to reach the owner by push and email, and neither can be sent
  from a browser. It no longer writes anything: the rows are already in
  Postgres by the time this is called.
*/
const ALERT_ENDPOINT = "/api/analytics/collect";
/** Per-session enrichment the browser cannot derive. See /api/analytics/context. */
const CONTEXT_ENDPOINT = "/api/analytics/context";
const CONTEXT_KEY = "frenz_actx";

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

/* ───────────────────── the enrichment the browser cannot derive ──────────── */

/**
 * Geo, device and the bot verdict, for THIS session.
 *
 * The old collect route derived these per request, from headers only a server
 * sees. Writing straight to Postgres means they have to be carried, so they are
 * fetched once per session from an edge route that does nothing else and logs
 * nothing (see app/api/analytics/context/route.ts) and cached under the session
 * id — a new session re-fetches, because a visitor can move.
 *
 * ⚠️ THIS IS THE ONE PLACE THE MIGRATION LOSES GROUND, AND IT IS WORTH NAMING.
 * These fields used to be unforgeable per event. They are now stamped once by
 * the server and relayed by the client, so a hostile visitor could alter their
 * own country or clear their own bot flag. `user_id` and `received_at` stay
 * unforgeable because Postgres computes them inside `track_events`. The
 * alternative — a server round-trip per batch — is the cost being removed.
 */
interface SessionContext {
  country: string | null;
  region: string | null;
  city: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  isBot: boolean;
}

let context: SessionContext | null = null;
let contextFetch: Promise<void> | null = null;

function cachedContext(sessionId: string): SessionContext | null {
  try {
    const raw = sessionStorage.getItem(CONTEXT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { sid?: string; ctx?: SessionContext };
    // Keyed by session id so a NEW session does not inherit the old one's geo.
    return parsed?.sid === sessionId && parsed.ctx ? parsed.ctx : null;
  } catch {
    return null;
  }
}

/**
 * Ensure the context is in hand. Idempotent, never throws, never blocks a
 * caller that cannot wait — a flush with no context still sends, with null geo,
 * because an event without a country beats no event.
 */
function ensureContext(sessionId: string): Promise<void> {
  if (context || contextFetch) return contextFetch ?? Promise.resolve();
  const cached = cachedContext(sessionId);
  if (cached) {
    context = cached;
    return Promise.resolve();
  }
  contextFetch = (async () => {
    try {
      const res = await fetch(CONTEXT_ENDPOINT, { cache: "no-store" });
      if (!res.ok) return;
      const ctx = (await res.json()) as SessionContext;
      context = ctx;
      try {
        sessionStorage.setItem(CONTEXT_KEY, JSON.stringify({ sid: sessionId, ctx }));
      } catch {
        /* storage blocked — refetched next load, which is one call, not a failure */
      }
    } catch {
      /* offline or blocked — events still send, without geo */
    } finally {
      contextFetch = null;
    }
  })();
  return contextFetch;
}

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

/** The download lifecycle statuses that own a canonical `analytics_downloads` row. */
const STATUS_FROM_TYPE: Partial<Record<AnalyticsEventType, DownloadStatus>> = {
  download_requested: "requested",
  download_started: "started",
  download_preparing: "preparing",
  download_completed: "completed",
  download_failed: "failed",
  download_cancelled: "cancelled",
};

/** One queued event as the `track_events` payload wants it: snake_case, ISO time. */
function toRow(e: AnalyticsEventInput, ctx: SessionContext | null): Record<string, unknown> {
  return {
    event_id: e.eventId,
    event_type: e.type,
    visitor_id: e.visitorId,
    session_id: e.sessionId,
    download_id: e.downloadId ?? null,
    /*
      ISO, not epoch ms, because the function parses a timestamptz. It never
      TRUSTS this value — it clamps it to [now-24h, now] — so this only fixes
      the ordering of events within one batch.
    */
    occurred_at: new Date(e.occurredAt).toISOString(),
    path: e.path ?? null,
    referrer: e.referrer ?? null,
    country: ctx?.country ?? null,
    region: ctx?.region ?? null,
    city: ctx?.city ?? null,
    device: ctx?.device ?? null,
    browser: ctx?.browser ?? null,
    os: ctx?.os ?? null,
    is_bot: ctx?.isBot ?? false,
    // Derived from the event name, never hand-listed — see ./features.
    feature: featureOf(e.type),
    properties: e.properties ?? {},
  };
}

/**
 * The canonical per-download rows this batch implies.
 *
 * Within a batch the LATEST event by its own clock wins, not the last in array
 * order — and `track_download_state` enforces the same rule ACROSS batches via
 * `last_event_at`. That pairing is load-bearing: the queue re-queues a failed
 * batch to the FRONT, so a retried batch is delivered after the one behind it,
 * and a plain last-write-wins upsert reverted completed downloads to
 * 'requested' and nulled their file size.
 */
function downloadRowsFor(
  batch: AnalyticsEventInput[],
  ctx: SessionContext | null,
): Record<string, unknown>[] {
  const rows = new Map<string, Record<string, unknown>>();
  for (const e of batch) {
    const status = STATUS_FROM_TYPE[e.type];
    if (!status || !e.downloadId) continue;
    const props = e.properties ?? {};
    const at = new Date(e.occurredAt).toISOString();
    const existing = rows.get(e.downloadId);
    if (existing && String(existing.last_event_at) > at) continue;
    rows.set(e.downloadId, {
      download_id: e.downloadId,
      visitor_id: e.visitorId,
      session_id: e.sessionId,
      platform: props.platform ?? null,
      media_kind: props.mediaKind ?? null,
      quality: props.quality ?? null,
      status,
      error_reason: props.errorReason ?? null,
      file_size: props.fileSize ?? null,
      duration_ms: props.durationMs ?? null,
      retry_of: props.retryOf ?? null,
      batch_id: props.batchId ?? null,
      link_key: props.linkKey ?? null,
      country: ctx?.country ?? null,
      device: ctx?.device ?? null,
      is_bot: ctx?.isBot ?? false,
      last_event_at: at,
    });
  }
  return [...rows.values()];
}

/**
 * Tell the server about a download that failed, was cancelled, or succeeded
 * only after retrying — the three things the owner is alerted about by push and
 * email, neither of which a browser can send.
 *
 * 🔴 THIS IS THE ONLY REMAINING VERCEL CALL ON THE EVENT PATH, and it is
 * deliberately rare: terminal download events are ~3.7% of volume. It writes
 * nothing, because the rows are already in Postgres by now — so when it fails,
 * the data is still correct and only a notification is missed.
 */
function reportOutcome(batch: AnalyticsEventInput[], unloading: boolean): void {
  const notable = batch.filter((e) => {
    if (!e.downloadId) return false;
    const status = STATUS_FROM_TYPE[e.type];
    if (status === "failed" || status === "cancelled") return true;
    /*
      A success that needed more than one attempt. `attempts` is sent on
      completion only; anything <= 1 is the normal case and must not alert —
      the owner is not told about the thing that is supposed to happen.
    */
    if (status !== "completed") return false;
    const attempts = (e.properties ?? {}).attempts;
    return typeof attempts === "number" && attempts > 1;
  });
  if (notable.length === 0) return;
  const body = JSON.stringify({ events: notable, alertsOnly: true });
  try {
    void fetch(ALERT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    if (unloading && hasWindow && navigator.sendBeacon) {
      try {
        navigator.sendBeacon(ALERT_ENDPOINT, new Blob([body], { type: "application/json" }));
      } catch {
        /* best effort — an alert is never worth an error in the page */
      }
    }
  }
}

async function flush(unloading = false): Promise<void> {
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  /*
    Wait for the enrichment on a NORMAL flush only. A normal flush happens 3
    seconds after an event at the earliest, so awaiting a request that is
    almost always already cached costs nothing anyone can perceive. On the way
    out there is nothing to await with, so whatever is cached is what is sent.
  */
  if (!unloading) {
    try {
      await ensureContext(batch[0]!.sessionId);
    } catch {
      /* enrichment is never allowed to block the send */
    }
  }
  const ctx = context;

  const ok = await postIngest(
    "track_events",
    { p_events: batch.map((e) => toRow(e, ctx)) },
    unloading,
  );
  if (!ok) {
    /*
      Put it back at the FRONT and try on the next flush — the same contract
      the old endpoint had. `on conflict (event_id) do nothing` is what makes
      the replay exactly-once rather than a double count.
    */
    queue.unshift(...batch);
    return;
  }

  /*
    The canonical download rows go in a SECOND call, after the events landed.
    Deliberately not folded into one RPC: the event log is the source of truth
    and must never be lost because a derived upsert failed. Most flushes carry
    no download at all and make no second call.
  */
  const rows = downloadRowsFor(batch, ctx);
  if (rows.length > 0) {
    void postIngest("track_download_state", { p_rows: rows }, unloading);
  }

  reportOutcome(batch, unloading);
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
    /**
     * Which BATCH and which SOURCE LINK this download belongs to.
     *
     * Sent on every stage, not just `requested` like `sourceUrl`, because the
     * admin outcome alert groups by them and it fires from the terminal event
     * (`failed`/`cancelled`) — an identifier that only rode the first event
     * would not be there when it is needed. They are short opaque ids, not the
     * URL, so repeating them costs nothing like storing the link four times.
     *
     * `linkKey` equals `batchId` when a single link expanded into several
     * media, and the per-source id inside a multi-link batch. Both absent for a
     * plain single download. See migration 0137.
     */
    batchId?: string | null;
    linkKey?: string | null;
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
  /*
    Learn who this is, now.

    The member's access token is what makes `auth.uid()` resolve inside
    `track_events`, and it can only be read asynchronously — while the flush that
    matters most, on `pagehide`, has nothing to await with. So it is primed here,
    on module load, which is already after hydration because this whole module
    arrives through a dynamic import.

    ⚠️ The window this leaves: a member who lands and leaves within the few
    hundred milliseconds before the session resolves has that first page view
    attributed to a guest. The alternative is blocking the first flush on auth,
    and analytics does not get to put itself in front of the page.
  */
  void primeIdentity();

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
