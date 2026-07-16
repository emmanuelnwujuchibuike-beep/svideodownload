"use client";

/**
 * A tiny stale-while-revalidate cache — the data backbone for "instant feel".
 *
 * Built on the same module-store + useSyncExternalStore idiom used elsewhere in
 * the app (no SWR/React-Query dependency, no bundle weight). It gives every
 * surface the behaviour users expect from Instagram/TikTok:
 *   - render cached data immediately (stale), never a blank screen,
 *   - revalidate in the background and swap in fresh data silently,
 *   - dedupe identical concurrent requests,
 *   - optimistic mutate() with silent rollback on error,
 *   - revalidate on window focus + reconnect.
 *
 * Keys are plain strings the caller owns (e.g. `feed:for_you`, `me`).
 */

export interface CacheEntry<T = unknown> {
  data: T | undefined;
  error: unknown;
  /** epoch ms of last successful load; 0 means never loaded. */
  updatedAt: number;
  /** in-flight request, used to dedupe + drive `isValidating`. */
  promise?: Promise<unknown>;
  /** Bumped on every `mutate()` — lets a slow `revalidate()` fetch that
   *  started BEFORE a later optimistic write detect, once it finally
   *  resolves, that it's now stale (see the real race this closes below). */
  version?: number;
}

const EMPTY: CacheEntry = Object.freeze({ data: undefined, error: undefined, updatedAt: 0 });

const cache = new Map<string, CacheEntry>();
const listeners = new Map<string, Set<() => void>>();
/** Active fetchers by key, so focus/reconnect can revalidate what's mounted. */
const fetchers = new Map<string, () => Promise<unknown>>();

function notify(key: string): void {
  const ls = listeners.get(key);
  if (ls) for (const l of ls) l();
}

export function subscribe(key: string, cb: () => void): () => void {
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (set!.size === 0) listeners.delete(key);
  };
}

export function getEntry<T>(key: string): CacheEntry<T> {
  return (cache.get(key) as CacheEntry<T>) ?? (EMPTY as CacheEntry<T>);
}

function patch(key: string, next: Partial<CacheEntry>): void {
  const prev = cache.get(key) ?? EMPTY;
  cache.set(key, { ...prev, ...next });
  notify(key);
}

export function registerFetcher(key: string, fetcher: () => Promise<unknown>): void {
  fetchers.set(key, fetcher);
}
export function unregisterFetcher(key: string): void {
  fetchers.delete(key);
}

/**
 * Fetch + cache `key`, deduping in-flight requests. If fresh data exists within
 * `dedupeMs`, returns it without a network call.
 */
export function revalidate<T>(key: string, fetcher: () => Promise<T>, dedupeMs = 2000): Promise<T> {
  const cur = cache.get(key) as CacheEntry<T> | undefined;
  if (cur?.promise) return cur.promise as Promise<T>;
  if (cur && cur.data !== undefined && Date.now() - cur.updatedAt < dedupeMs) {
    return Promise.resolve(cur.data);
  }

  // Real race found 2026-07-15: a fetch started here (e.g. a component's
  // mount-time GET) can still be in flight when a user fires an optimistic
  // `mutate()` (a settings toggle, a chat-appearance pick) — this response
  // then lands AFTER that mutate and silently overwrote it with the older
  // pre-click value, since it always just blindly wrote `data` on success.
  // Capturing the version here and comparing it when the fetch resolves
  // detects exactly that: if a mutate landed in between, this response is
  // now stale and gets discarded instead of clobbering the newer value.
  const startVersion = cur?.version ?? 0;
  const promise = fetcher()
    .then((data) => {
      const latest = cache.get(key) as CacheEntry<T> | undefined;
      if (latest && (latest.version ?? 0) !== startVersion) {
        patch(key, { promise: undefined });
        return latest.data as T;
      }
      patch(key, { data, error: undefined, updatedAt: Date.now(), promise: undefined });
      return data;
    })
    .catch((error) => {
      // Keep stale data on error (don't blank the UI); surface the error flag.
      patch(key, { error, promise: undefined });
      throw error;
    });

  patch(key, { promise });
  return promise;
}

/**
 * Optimistically update cached data, then optionally revalidate. Returns a
 * rollback fn that restores the previous value (call it if the server rejects).
 */
export function mutate<T>(key: string, updater: T | ((prev: T | undefined) => T)): () => void {
  const prevEntry = cache.get(key) as CacheEntry<T> | undefined;
  const prev = prevEntry?.data;
  const prevVersion = prevEntry?.version ?? 0;
  const next = typeof updater === "function" ? (updater as (p: T | undefined) => T)(prev) : updater;
  patch(key, { data: next, version: prevVersion + 1 });
  return () => {
    // Bump from whatever the version is AT ROLLBACK TIME, not the stale
    // `prevVersion` this closure captured when the optimistic write
    // happened — something else may have mutated the same key in between.
    const atRollback = (cache.get(key) as CacheEntry<T> | undefined)?.version ?? 0;
    patch(key, { data: prev, version: atRollback + 1 });
  };
}

/** Drop a key (e.g. on sign-out). */
export function invalidate(key: string): void {
  cache.delete(key);
  notify(key);
}

/* ------------------ global focus + reconnect revalidation ------------------ */

let wired = false;
function revalidateAllMounted(): void {
  for (const [key, fetcher] of fetchers) void revalidate(key, fetcher, 0).catch(() => {});
}

// Every key ever queried (every post's comments, every profile visited, …)
// stays in this Map for the rest of the tab's life — there was no eviction
// at all. Under memory pressure, drop entries nothing is currently
// subscribed to (no mounted component reading them) and that haven't been
// touched in a while — still-mounted surfaces (an active `listeners` set)
// are never touched, so this can't cause a visible blank-out.
const STALE_MS = 2 * 60_000;
function pruneInactive(): void {
  const cutoff = Date.now() - STALE_MS;
  for (const [key, entry] of cache) {
    if (listeners.get(key)?.size) continue; // still in use somewhere
    if (entry.promise) continue; // an in-flight fetch — don't drop mid-request
    if (entry.updatedAt > cutoff) continue; // recently used (0 for "never loaded" is always <= cutoff)
    cache.delete(key);
  }
}

export function ensureGlobalRevalidation(): void {
  if (wired || typeof window === "undefined") return;
  wired = true;
  window.addEventListener("focus", revalidateAllMounted);
  window.addEventListener("online", revalidateAllMounted);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") revalidateAllMounted();
  });
  // `visibilitychange` doesn't reliably fire for a BACK-FORWARD CACHE
  // restore — iOS Safari's edge-swipe "back" gesture (and any browser's
  // back/forward button, to a lesser extent) can restore a frozen page
  // without the tab ever having gone through a "hidden" state from the
  // page's own perspective. `pageshow` with `event.persisted === true` is
  // the event actually meant for this. Without it, a query key whose fetch
  // was still in flight (or already stale) at the moment the page was
  // frozen stays exactly that way forever after a gesture-back restore —
  // found chasing a "messages page stuck loading, only after the iOS
  // back-gesture" report.
  window.addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    // A fetch that was still in-flight at the exact moment the page froze
    // dies with the frozen document — its underlying connection never
    // settles, orphaning the recorded `promise` forever. `revalidate()`
    // dedupes against `cur.promise` unconditionally (by design, for the
    // normal case), so without this, every future call for that key —
    // including the very `revalidateAllMounted()` below — just hands back
    // the same permanently-pending promise instead of ever fetching again.
    // Found chasing an admin-only "stuck loading after iOS swipe-back"
    // report whose root cause was a sibling bug (a `verifying` flag gated
    // on an in-flight fetch's `finally`, same failure family) — this closes
    // the equivalent gap in the shared cache every other query relies on.
    for (const entry of cache.values()) entry.promise = undefined;
    revalidateAllMounted();
  });
  void import("@/lib/observability/memory-pressure").then(({ onMemoryPressure }) => onMemoryPressure(pruneInactive));
}
