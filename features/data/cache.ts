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

  const promise = fetcher()
    .then((data) => {
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
  const prev = (cache.get(key) as CacheEntry<T> | undefined)?.data;
  const next = typeof updater === "function" ? (updater as (p: T | undefined) => T)(prev) : updater;
  patch(key, { data: next });
  return () => patch(key, { data: prev });
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
  void import("@/lib/observability/memory-pressure").then(({ onMemoryPressure }) => onMemoryPressure(pruneInactive));
}
