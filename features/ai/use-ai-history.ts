"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { listAiJobs } from "@/lib/ai/client";
import type { AiHistoryFilter } from "@/lib/ai/history";
import {
  appendAiHistoryPage,
  getAiHistoryServerSnapshot,
  getAiHistorySnapshot,
  replaceAiHistoryFirstPage,
  subscribeAiHistory,
} from "@/lib/ai/history-store";
import type { AiJobView } from "@/lib/ai/jobs";
import { hasAuthCookie } from "@/lib/auth/has-auth-cookie";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE AI HISTORY LIST — read from the device, asked of the server rarely
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-10-06: "it should save in local storage like the download
 * history and never call server each time a user enters the page or view a
 * video or audio."
 *
 * The list is `lib/ai/history-store.ts`. This hook only READS it, except:
 *
 *   · the FIRST visit on this browser for this account (the store has never
 *     synced) asks for one page, once;
 *   · Refresh and Show more — the member's own taps.
 *
 * 🔴 What it no longer does: fetch on every entry, and poll every 15 s while
 * a row was running. A running job is kept current by the pages that run it
 * (they read the job, and every read passes through lib/ai/client.ts into the
 * store), so the History page shows the latest state without asking.
 */

const PAGE_SIZE = 30;

export interface AiHistoryState {
  jobs: AiJobView[];
  filter: AiHistoryFilter;
  loading: boolean;
  loadingMore: boolean;
  /** A Refresh (or the first sync) is in flight — rows may already be on screen. */
  refreshing: boolean;
  error: string | null;
  hasMore: boolean;
  loaded: boolean;
}

export interface AiHistoryActions {
  setFilter: (filter: AiHistoryFilter) => void;
  loadMore: () => void;
  refresh: () => void;
}

export function useAiHistory(initialFilter: AiHistoryFilter = "all"): AiHistoryState & AiHistoryActions {
  const snapshot = useSyncExternalStore(subscribeAiHistory, getAiHistorySnapshot, getAiHistoryServerSnapshot);
  const [filter, setFilter] = useState<AiHistoryFilter>(initialFilter);
  const [fetching, setFetching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    setHydrated(true);
    return () => {
      alive.current = false;
    };
  }, []);

  const fetchFirstPage = useCallback(async () => {
    setFetching(true);
    setError(null);
    const res = await listAiJobs({ limit: PAGE_SIZE });
    if (!alive.current) return;
    setFetching(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    replaceAiHistoryFirstPage(res.jobs, res.nextCursor);
  }, []);

  /*
    The one automatic request: an account that has never synced on this
    browser. After that, entering the page asks nothing.
  */
  useEffect(() => {
    if (!hasAuthCookie()) return;
    if (getAiHistorySnapshot().syncedAt === null) void fetchFirstPage();
  }, [fetchFirstPage]);

  const loadMore = useCallback(() => {
    const cursor = getAiHistorySnapshot().cursor;
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    void (async () => {
      const res = await listAiJobs({ limit: PAGE_SIZE, cursor });
      if (!alive.current) return;
      setLoadingMore(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      appendAiHistoryPage(res.jobs, res.nextCursor);
    })();
  }, [loadingMore]);

  return {
    jobs: snapshot.jobs,
    filter,
    // a skeleton only for an empty first visit — never over rows already on screen
    loading: !hydrated || (fetching && snapshot.jobs.length === 0),
    loadingMore,
    refreshing: fetching,
    error: snapshot.jobs.length === 0 ? error : null,
    hasMore: !!snapshot.cursor,
    loaded: hydrated && (snapshot.syncedAt !== null || !fetching),
    setFilter,
    loadMore,
    refresh: () => void fetchFirstPage(),
  };
}
