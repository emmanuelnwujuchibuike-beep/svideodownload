"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Page } from "@/lib/sdk";

import { getEntry, mutate } from "./cache";

interface InfiniteState<T> {
  items: T[];
  cursor: string | null;
  done: boolean;
  loaded: boolean;
}

export interface InfiniteResult<T> {
  items: T[];
  error: unknown;
  /** First load, nothing cached yet → show a skeleton. */
  isLoading: boolean;
  /** Appending the next page. */
  isLoadingMore: boolean;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  /** Reset to page 1 (pull-to-refresh / tab switch). */
  refresh: () => Promise<void>;
}

const blank = <T,>(): InfiniteState<T> => ({ items: [], cursor: null, done: false, loaded: false });

/**
 * Cursor-paginated, stale-while-revalidate list for infinite scroll.
 *
 * Accumulated pages are written through to the shared cache under `key`, so
 * navigating away and back restores the whole list (and scroll feel) instantly
 * instead of refetching from scratch — the behaviour you get on TikTok/IG back-nav.
 * `fetchPage(cursor)` returns `{ items, nextCursor }` (e.g. `getApi().feed(...)`).
 */
export function useInfiniteQuery<T>(
  key: string,
  fetchPage: (cursor: string | null) => Promise<Page<T>>,
  options: { enabled?: boolean } = {},
): InfiniteResult<T> {
  const { enabled = true } = options;
  const seeded = getEntry<InfiniteState<T>>(key).data;

  const [state, setState] = useState<InfiniteState<T>>(seeded ?? blank<T>());
  const [error, setError] = useState<unknown>(null);
  const [isLoading, setIsLoading] = useState<boolean>(!seeded?.loaded);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const stateRef = useRef(state);
  stateRef.current = state;
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const busy = useRef(false);

  const persist = useCallback(
    (next: InfiniteState<T>) => {
      setState(next);
      mutate<InfiniteState<T>>(key, next);
    },
    [key],
  );

  const loadMore = useCallback(async () => {
    if (busy.current || stateRef.current.done) return;
    busy.current = true;
    setIsLoadingMore(true);
    try {
      const page = await fetchRef.current(stateRef.current.cursor);
      persist({
        items: [...stateRef.current.items, ...page.items],
        cursor: page.nextCursor,
        done: page.nextCursor === null,
        loaded: true,
      });
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      busy.current = false;
      setIsLoadingMore(false);
      setIsLoading(false);
    }
  }, [persist]);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const page = await fetchRef.current(null);
      persist({ items: page.items, cursor: page.nextCursor, done: page.nextCursor === null, loaded: true });
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      busy.current = false;
      setIsLoading(false);
    }
  }, [persist]);

  useEffect(() => {
    if (!enabled) return;
    // Re-seed local state from the cache for this key (handles key changes such
    // as switching feed tabs), then: nothing cached → first load; cached →
    // silent background refresh of page 1.
    const cached = getEntry<InfiniteState<T>>(key).data;
    const seed = cached ?? blank<T>();
    stateRef.current = seed;
    setState(seed);
    setIsLoading(!cached?.loaded);
    if (!seed.loaded) void loadMore();
    else void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return {
    items: state.items,
    error,
    isLoading: isLoading && state.items.length === 0,
    isLoadingMore,
    hasMore: !state.done,
    loadMore,
    refresh,
  };
}
