"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

import { type ApiResult, walletApi } from "./api";

/*
  The wallet's whole client runtime, in one place so it can be audited (Part 5 performance brief):

  · Pages are server-rendered with their data. The router cache (next.config staleTimes, 6 h) replays that payload on
    back-swipe and re-entry, so going back costs NO request and never flashes a skeleton.
  · A confirmed money action calls `router.refresh()` once — that re-reads the current route AND drops the router cache,
    so the next /wallet visit is fresh. Nothing refreshes on mount, on focus or on a timer.
  · Coming back to a tab that sat hidden for a long time (≥ 5 min) refreshes once, silently: the old numbers stay on
    screen until the new ones land. Pull-to-refresh (features/app-shell/page-refresh.tsx) still works everywhere.
  · Every client request belongs to its screen: a newer request aborts the older one (no out-of-order overwrite) and
    leaving the screen aborts whatever is in flight.

  Nothing here is authoritative: every amount, fee and permission is decided again by the route that acts on it.
*/

/** Latest-wins requests owned by a component: `run` aborts the previous one; unmount aborts all. null = superseded. */
export function useLatestRequest() {
  const ctrl = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      ctrl.current?.abort();
      ctrl.current = null;
    },
    [],
  );
  return useCallback(async <T>(fn: (signal: AbortSignal) => Promise<ApiResult<T>>): Promise<ApiResult<T> | null> => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    const r = await fn(c.signal);
    if (c.signal.aborted) return null;
    if (ctrl.current === c) ctrl.current = null;
    return r;
  }, []);
}

const HIDDEN_LONG_MS = 5 * 60_000;
// one refresh per return, however many wallet components listen
let lastReturnRefresh = 0;

/** Refresh the route once when the member comes back after the tab was hidden for a long time. */
export function useRefreshOnLongReturn(minHiddenMs = HIDDEN_LONG_MS) {
  const router = useRouter();
  useEffect(() => {
    let hiddenAt = document.hidden ? Date.now() : 0;
    const onVis = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      if (away < minHiddenMs || Date.now() - lastReturnRefresh < minHiddenMs) return;
      lastReturnRefresh = Date.now();
      router.refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [router, minHiddenMs]);
}

/** Wait until the page is visible (now, or on the next visibilitychange). Resolves false if aborted first. */
export function whenVisible(signal: AbortSignal): Promise<boolean> {
  if (typeof document === "undefined" || !document.hidden) return Promise.resolve(!signal.aborted);
  return new Promise((resolve) => {
    const done = (v: boolean) => {
      document.removeEventListener("visibilitychange", onVis);
      signal.removeEventListener("abort", onAbort);
      resolve(v);
    };
    const onVis = () => {
      if (!document.hidden) done(true);
    };
    const onAbort = () => done(false);
    document.addEventListener("visibilitychange", onVis);
    signal.addEventListener("abort", onAbort);
  });
}

// The bank list is public reference data (not the member's): one fetch per session, shared by every mount, deduped
// while in flight. A failure is not cached, so the next open tries again.
let banksPromise: Promise<ApiResult<{ banks: { name: string; code: string }[] }>> | null = null;
export function loadBanksOnce() {
  if (!banksPromise)
    banksPromise = walletApi.banks().then((r) => {
      if (!r.ok) banksPromise = null;
      return r;
    });
  return banksPromise;
}
/** Test hook: forget the shared bank list. */
export function _resetBanksCache() {
  banksPromise = null;
}
