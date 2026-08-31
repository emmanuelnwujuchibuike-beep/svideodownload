"use client";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE ONE PLACE THE ADMIN DASHBOARD IS ALLOWED TO REFRESH ITSELF
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-08-30: Vercel had burned $15 of a $20 monthly credit against
 * ~90–100 daily users, and the admin dashboard is left open for hours.
 *
 * ── What it was costing (measured from the code, per hour, tab OPEN) ─────────
 *
 *   /api/admin/analytics/stream   an SSE route holding a Node function open for
 *                                 5 MINUTES at a time, re-running the full
 *                                 analytics aggregate every 10s, and — because
 *                                 EventSource reconnects on close — doing that
 *                                 again immediately, forever. That is 60
 *                                 function-MINUTES of compute per hour of wall
 *                                 clock, plus ~360 multi-query aggregates.
 *   /api/admin/activity           every 2.5s → 1,440 requests/hour.
 *   support threads               every 5s   →   720 requests/hour.
 *   support messages              every 4s   →   900 requests/hour.
 *
 * ≈3,000 invocations/hour and a function running essentially 100% of the time,
 * for one person looking at a page. None of it stopped when the tab was hidden:
 * the activity feed's recursive timer kept going, and an EventSource does not
 * care about visibility at all.
 *
 * ── Why this is a scheduler and not four fixed intervals ─────────────────────
 *
 * The brief's rule: one refresh mechanism serving many widgets, never one
 * polling loop per widget. So subscribers register a KEY and a TIER here, and a
 * single timer drives all of them:
 *
 *   • Two widgets asking for the same key share ONE request and one result.
 *     (`fetchRecentActivity` was being asked for by the feed alone today, but
 *     the dashboard has a dozen widgets and the next one to want activity must
 *     not add a second loop.)
 *   • Nothing runs while the tab is hidden. Not throttled — STOPPED.
 *   • A failing endpoint backs off instead of retrying at full rate, so an
 *     outage cannot turn into a request flood. That is the cost-safety
 *     guarantee the brief asks for: there is no path here that shortens an
 *     interval, only ones that lengthen it.
 *
 * ── Why the data still goes through Vercel ──────────────────────────────────
 *
 * 🔴 Supabase Realtime was considered for the activity feed and deliberately
 * REJECTED. `lib/admin/activity.ts` is `server-only` and reads `events`,
 * `downloads` and `profiles` through `createAdminClient()` — the SERVICE ROLE.
 * Those tables have no admin-readable RLS policy, so a browser subscription
 * would mean publishing them to the client and writing new policies to let an
 * admin session read them directly. The brief is explicit that admin
 * operations must not move to the browser to save money, so they have not.
 * The saving comes from frequency and lifetime, not from weakening the guard.
 */

/** How often each class of data may be re-fetched, at most. */
export const TIER_MS = {
  /**
   * The live activity feed. 15s, not 2.5s: the request is an incremental
   * `?since=` cursor that usually returns an empty array, so the old rate was
   * paying a full admin auth check (`getAdminUser` re-reads the role from the
   * database on EVERY request) 1,440 times an hour to learn nothing 1,400 of
   * those times.
   */
  live: 15_000,
  /** Dashboard statistics — the brief's "30–60 seconds" band. */
  stats: 60_000,
  /** Expensive aggregates and historical analytics. */
  slow: 5 * 60_000,
} as const;

export type Tier = keyof typeof TIER_MS;

/** The base tick. Every due key is checked on this cadence, not on its own timer. */
const TICK_MS = 5_000;

/** Backoff after consecutive failures, in multiples of the tier interval. */
const MAX_BACKOFF_FACTOR = 8;

interface Entry {
  tier: Tier;
  fetcher: () => Promise<unknown>;
  subscribers: Set<(value: unknown, error: unknown) => void>;
  lastRunAt: number;
  failures: number;
  inflight: Promise<unknown> | null;
  /** The last good value, replayed to a component that mounts mid-cycle. */
  last: unknown;
}

const entries = new Map<string, Entry>();
let timer: ReturnType<typeof setInterval> | null = null;
let visibilityBound = false;

function dueAt(e: Entry): number {
  // Backoff multiplies the interval; it never divides it. There is no branch in
  // this file that can make anything poll FASTER than its tier.
  const factor = Math.min(MAX_BACKOFF_FACTOR, 2 ** e.failures);
  return e.lastRunAt + TIER_MS[e.tier] * factor;
}

async function run(key: string, e: Entry): Promise<void> {
  if (e.inflight) return; // never stack requests for one key
  e.lastRunAt = Date.now();
  const p = e.fetcher();
  e.inflight = p;
  try {
    const value = await p;
    e.failures = 0;
    e.last = value;
    for (const s of e.subscribers) s(value, null);
  } catch (err) {
    e.failures += 1;
    for (const s of e.subscribers) s(undefined, err);
  } finally {
    e.inflight = null;
  }
}

function sweep(): void {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  const now = Date.now();
  for (const [key, e] of entries) {
    if (e.subscribers.size === 0) continue;
    if (now >= dueAt(e)) void run(key, e);
  }
}

function ensureTimer(): void {
  if (typeof window === "undefined") return;
  if (!visibilityBound) {
    visibilityBound = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") {
        // HARD STOP. A hidden dashboard costs nothing at all — the brief's
        // "idle dashboard generates essentially no unnecessary polling traffic".
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
        return;
      }
      /*
        One catch-up sweep on return, then the normal cadence. Exactly one:
        re-running every key immediately AND restarting the timer is how a tab
        that is switched to repeatedly turns into a request burst.
      */
      ensureTimer();
      sweep();
    });
  }
  if (timer) return;
  timer = setInterval(sweep, TICK_MS);
}

/**
 * Register interest in a key. Returns an unsubscribe function.
 *
 * The first subscriber for a key triggers an immediate fetch (an operator who
 * just opened the page should not wait a full interval); later subscribers get
 * the cached value replayed and cost nothing.
 */
export function subscribe(
  key: string,
  tier: Tier,
  fetcher: () => Promise<unknown>,
  onUpdate: (value: unknown, error: unknown) => void,
): () => void {
  let e = entries.get(key);
  if (!e) {
    e = { tier, fetcher, subscribers: new Set(), lastRunAt: 0, failures: 0, inflight: null, last: undefined };
    entries.set(key, e);
  }
  // Keep the newest fetcher — a widget whose range changed re-subscribes with a
  // closure over the new range, and the old one must not keep being called.
  e.fetcher = fetcher;
  e.tier = tier;
  e.subscribers.add(onUpdate);

  if (e.last !== undefined) onUpdate(e.last, null);
  ensureTimer();
  if (Date.now() >= dueAt(e)) void run(key, e);

  return () => {
    e.subscribers.delete(onUpdate);
    /*
      🔴 Drop the entry when the last subscriber leaves. Without this, navigating
      away from the dashboard leaves the key registered and the sweep keeps
      fetching it forever — the "request that continues after navigating away"
      the brief calls out, and a memory leak besides.
    */
    if (e.subscribers.size === 0) {
      entries.delete(key);
      if (entries.size === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    }
  };
}

/** Force one key to refresh now — for an explicit operator "Refresh" tap. */
export function refreshNow(key: string): void {
  const e = entries.get(key);
  if (e) void run(key, e);
}

/** Test seam. */
export function __resetScheduler(): void {
  entries.clear();
  if (timer) clearInterval(timer);
  timer = null;
}

/** Introspection, for the cost-safety test. */
export function __activeKeys(): string[] {
  return [...entries.keys()];
}
