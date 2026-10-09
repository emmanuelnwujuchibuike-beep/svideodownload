"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import {
  ensureGlobalRevalidation,
  getEntry,
  registerFetcher,
  revalidate,
  subscribe,
  unregisterFetcher,
} from "./cache";

export interface QueryResult<T> {
  data: T | undefined;
  error: unknown;
  /** True only on the very first load with no cached data (show a skeleton). */
  isLoading: boolean;
  /** True while a background revalidation is in flight (cached data is showing). */
  isValidating: boolean;
  refetch: () => Promise<T>;
}

export interface QueryOptions<T = unknown> {
  /** Skip if false (e.g. waiting on auth). Default true. */
  enabled?: boolean;
  /** Suppress duplicate network calls within this window (ms). Default 2000. */
  dedupeMs?: number;
  /** Server-rendered seed data — shown instantly on first paint, then revalidated. */
  initialData?: T;
  /**
   * Revalidate this key on window focus / reconnect / tab-visible / iOS
   * back-swipe (bfcache restore). Default true. Set false for surfaces kept
   * fresh by their own realtime subscription (inbox) or meant to stay frozen
   * between genuine loads (Stories) — otherwise the blanket refetch on every
   * resume reads as a visible "reload" on back-swipe. The key still loads on
   * mount and still updates on explicit `revalidate()`/`mutate()` calls.
   */
  revalidateOnFocus?: boolean;
  /**
   * Fetch when the component mounts. Default true. Set false where a remount
   * is not news — a back-swipe to the inbox — and the cache is kept current
   * by realtime + explicit `revalidate()`. Only skipped when the cache ALREADY
   * holds data for the key; a cold key always loads.
   */
  revalidateOnMount?: boolean;
}

/**
 * Stale-while-revalidate read. Renders cached data instantly, revalidates in the
 * background, dedupes concurrent callers of the same key, and refreshes on window
 * focus/reconnect. The fetcher usually calls the SDK (`getApi().…`).
 */
export function useQuery<T>(key: string, fetcher: () => Promise<T>, options: QueryOptions<T> = {}): QueryResult<T> {
  const { enabled = true, dedupeMs, initialData, revalidateOnFocus = true, revalidateOnMount = true } = options;

  const entry = useSyncExternalStore(
    (cb) => subscribe(key, cb),
    () => getEntry<T>(key),
    () => getEntry<T>(key),
  );

  // Keep the latest fetcher without retriggering effects on every render.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refetch = useCallback(() => revalidate<T>(key, () => fetcherRef.current(), dedupeMs), [key, dedupeMs]);

  useEffect(() => {
    if (!enabled) return;
    ensureGlobalRevalidation();
    registerFetcher(key, () => fetcherRef.current(), revalidateOnFocus);
    const warm = getEntry<T>(key).data !== undefined;
    if (revalidateOnMount || !warm) void refetch().catch(() => {});
    return () => unregisterFetcher(key, revalidateOnFocus);
  }, [key, enabled, refetch, revalidateOnFocus, revalidateOnMount]);

  return {
    // Fall back to the SSR seed until the cache is populated, so content paints
    // on first render instead of after a client round-trip.
    data: entry.data ?? initialData,
    error: entry.error,
    isLoading: entry.updatedAt === 0 && entry.data === undefined && initialData === undefined && !entry.error,
    isValidating: !!entry.promise,
    refetch,
  };
}
