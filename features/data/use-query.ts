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
}

/**
 * Stale-while-revalidate read. Renders cached data instantly, revalidates in the
 * background, dedupes concurrent callers of the same key, and refreshes on window
 * focus/reconnect. The fetcher usually calls the SDK (`getApi().…`).
 */
export function useQuery<T>(key: string, fetcher: () => Promise<T>, options: QueryOptions<T> = {}): QueryResult<T> {
  const { enabled = true, dedupeMs, initialData } = options;

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
    registerFetcher(key, () => fetcherRef.current());
    void refetch().catch(() => {});
    return () => unregisterFetcher(key);
  }, [key, enabled, refetch]);

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
