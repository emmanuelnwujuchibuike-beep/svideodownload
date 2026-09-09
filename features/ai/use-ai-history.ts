"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { listAiJobs } from "@/lib/ai/client";
import { historyHasActive, statusesForFilter, type AiHistoryFilter } from "@/lib/ai/history";
import { readAiHistoryCache, writeAiHistoryCache } from "@/lib/ai/history-cache";
import type { AiJobView } from "@/lib/ai/jobs";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE HISTORY LIST — paging, refreshing, and one poll for live rows
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `useAiCleanJob` owns ONE job through its whole life. This owns a LIST of past
 * ones, and the two are deliberately separate hooks rather than one bigger one:
 * the workspace needs a state machine (upload, start, reward, poll, cancel) and
 * the history section needs a cursor. Merging them would hand every page that
 * lists jobs the whole submission machinery, and the AI page — a welcome
 * screen — would ship it just to open.
 *
 * ── 🔴 THE FILTER IS PART OF THE REQUEST ─────────────────────────────────────
 *
 * Changing tabs starts a NEW list from no cursor. It does not filter what is
 * already loaded: the pages are keyset, so a tab's rows can be anywhere in the
 * member's history, and filtering locally would show an empty "Cancelled" next
 * to a "Show more" button. See lib/ai/history.ts.
 *
 * ── One poll, and only while something is actually running ───────────────────
 *
 * A member who left the app mid-job and came back to this section is the whole
 * reason it exists, so a row that says "Working" has to become "Ready" without
 * a manual refresh. The same battery rule the rest of Frenz AI is held to still
 * applies: the timer exists ONLY while a visible row is active, it stops the
 * moment none is, and it does nothing while the tab is hidden.
 *
 * It re-reads the FIRST page only. Paging back through history to re-check a
 * row from last week is work nobody asked for; a running job is by definition
 * recent, so it is on page one.
 */

const PAGE_SIZE = 8;
/** Slow on purpose. A running job takes minutes, and this is a background list. */
const POLL_MS = 15_000;

export interface AiHistoryState {
  jobs: AiJobView[];
  filter: AiHistoryFilter;
  /** True during the FIRST load of a filter — the skeleton condition. */
  loading: boolean;
  /** True while "Show more" is fetching. The list stays visible. */
  loadingMore: boolean;
  /** Null unless the list itself could not be read. */
  error: string | null;
  hasMore: boolean;
  /** False until the first answer for this filter has arrived. */
  loaded: boolean;
}

export interface AiHistoryActions {
  setFilter: (filter: AiHistoryFilter) => void;
  loadMore: () => void;
  /** Re-read page one, keeping the tab. */
  refresh: () => void;
}

export function useAiHistory(initialFilter: AiHistoryFilter = "all"): AiHistoryState & AiHistoryActions {
  const [filter, setFilterState] = useState<AiHistoryFilter>(initialFilter);
  /*
    🔴 SEEDED SYNCHRONOUSLY, so the page paints a list on its FIRST frame
    instead of a skeleton. The lazy initialiser runs during the first render —
    an effect would be one frame too late, which is exactly the flash the owner
    is comparing against the download history.
  */
  const [jobs, setJobs] = useState<AiJobView[]>(() => readAiHistoryCache() ?? []);
  const [cursor, setCursor] = useState<string | null>(null);
  /*
    Not "loading" when there is already something on screen. The skeleton is
    for an empty first visit; showing it OVER a cached list would replace real
    rows with grey boxes, which is worse than the wait it is meant to cover.
  */
  const [loading, setLoading] = useState(() => (readAiHistoryCache()?.length ?? 0) === 0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const alive = useRef(true);
  /**
   * 🔴 The guard that makes a fast double-tap on the tabs safe.
   *
   * Two in-flight list requests can answer out of order, and the one that
   * arrives last wins — which is how somebody ends up looking at "Cancelled"
   * with the completed rows under it. Every response checks this token against
   * the request it was made for and drops itself if the answer is stale.
   */
  const requestToken = useRef(0);
  const pollTimer = useRef<number | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
    };
  }, []);

  /** Page one for a filter. Replaces everything. */
  const load = useCallback(async (next: AiHistoryFilter) => {
    const token = ++requestToken.current;
    setLoading(true);
    setError(null);

    const res = await listAiJobs({
      feature: "ai_clean",
      limit: PAGE_SIZE,
      statuses: statusesForFilter(next),
    });
    if (!alive.current || token !== requestToken.current) return;

    if (!res.ok) {
      setError(res.error);
      setLoading(false);
      setLoaded(true);
      return;
    }
    setJobs(res.jobs);
    setCursor(res.nextCursor);
    setLoading(false);
    setLoaded(true);
    /*
      Only the "all" tab is remembered. A snapshot taken while "Cancelled" was
      selected would open the page next time showing a filtered list under an
      unfiltered heading — the cache exists to make the DEFAULT view instant,
      not to remember where somebody was.
    */
    if (next === "all") writeAiHistoryCache(res.jobs);
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  const setFilter = useCallback((next: AiHistoryFilter) => {
    setFilterState((current) => {
      if (current === next) return current;
      // Cleared here rather than in the effect, so the old tab's rows never
      // show for a frame under the new tab's name.
      setJobs([]);
      setCursor(null);
      return next;
    });
  }, []);

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore) return;
    const token = requestToken.current;
    setLoadingMore(true);
    void (async () => {
      const res = await listAiJobs({
        feature: "ai_clean",
        limit: PAGE_SIZE,
        cursor,
        statuses: statusesForFilter(filter),
      });
      // A tab change mid-page invalidates this answer: those rows belong to a
      // filter nobody is looking at any more.
      if (!alive.current || token !== requestToken.current) return;
      setLoadingMore(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      /*
        Appended with a seen-id guard. The cursor cannot repeat a row on its
        own, but a job that finished between two pages moves in the ordering,
        and React answers a duplicate key with a warning and an unstable list.
      */
      setJobs((prev) => {
        const seen = new Set(prev.map((j) => j.id));
        return [...prev, ...res.jobs.filter((j) => !seen.has(j.id))];
      });
      setCursor(res.nextCursor);
    })();
  }, [cursor, filter, loadingMore]);

  const refresh = useCallback(() => {
    void load(filter);
  }, [filter, load]);

  /*
    ── The live re-read ─────────────────────────────────────────────────────

    Only page one, only while a loaded row is still going to change, and never
    while the tab is hidden. `historyHasActive` asks `isActiveStatus` rather
    than listing statuses here: three hand-written copies of that question is
    the bug that once stopped this feature polling mid-job.
  */
  const hasActive = historyHasActive(jobs);

  useEffect(() => {
    if (!hasActive) return;

    let stopped = false;

    const schedule = () => {
      if (stopped || !alive.current) return;
      pollTimer.current = window.setTimeout(() => void tick(), POLL_MS);
    };

    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === "hidden") {
        schedule();
        return;
      }
      const token = requestToken.current;
      const res = await listAiJobs({
        feature: "ai_clean",
        limit: PAGE_SIZE,
        statuses: statusesForFilter(filter),
      });
      if (stopped || !alive.current || token !== requestToken.current) return;
      if (res.ok) {
        /*
          🔴 The refreshed page REPLACES the first PAGE_SIZE rows, never the
          whole list. Somebody who pressed "Show more" four times must not lose
          those rows because one job at the top finished.
        */
        setJobs((prev) => {
          const fresh = res.jobs;
          const freshIds = new Set(fresh.map((j) => j.id));
          const tail = prev.slice(fresh.length).filter((j) => !freshIds.has(j.id));
          return [...fresh, ...tail];
        });
      }
      schedule();
    };

    schedule();

    // Coming back to the tab checks immediately — somebody who reopens the app
    // to see whether their video is done should not wait out an interval.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
      void tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [hasActive, filter]);

  return {
    jobs,
    filter,
    loading,
    loadingMore,
    error,
    hasMore: !!cursor,
    loaded,
    setFilter,
    loadMore,
    refresh,
  };
}
