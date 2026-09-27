"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AI_REFRESH_EVENT, readAiViewCache, writeAiViewCache } from "@/lib/ai/view-cache";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A READ THAT SURVIVES GOING BACK
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-27: the AI pages "reload on everytime… back swipe and return
 * in the all the Ai pages never reload or load after first load, users can
 * revalidate only by swiping down from the top."
 *
 * So this is not the usual fetch-on-mount hook:
 *
 *   FIRST EVER OPEN     no snapshot → fetch, show the skeleton once, remember.
 *   EVERY RETURN AFTER  paint the snapshot on the FIRST FRAME and stop there.
 *                       No skeleton, no spinner, no request.
 *   PULL TO REFRESH     the member asks; the network runs (`AI_REFRESH_EVENT`).
 *   A MUTATION          the caller calls `refresh()` itself — generating,
 *                       deleting a voice, spending the allowance.
 *
 * ── 🔴 THE SNAPSHOT IS READ IN THE STATE INITIALISER ────────────────────────
 *
 * Not in an effect. An effect runs after the first paint, which means one frame
 * of empty page and a layout jump — precisely the "reload" flicker being
 * complained about. Reading it during the initialiser means the very first
 * frame is the real page. It is `useState(() => …)` so it happens once per
 * mount rather than on every render.
 *
 * ── 🔴 AND IT IS STILL SAFE ─────────────────────────────────────────────────
 *
 * A snapshot decides nothing (lib/ai/view-cache.ts). Every endpoint behind
 * these reads re-checks on its own terms — a price is recomputed at Generate, a
 * slot is counted at Start, an allowance is taken atomically. The worst a stale
 * snapshot can do is show a figure that is a few minutes old, and the server
 * refuses anything it disagrees with. That is the trade the owner asked for.
 */
export interface CachedView<T> {
  /** The answer, or null before the first ever one arrives. */
  data: T | null;
  /** Only ever true on a first-ever open, or while an explicit refresh runs. */
  loading: boolean;
  error: string | null;
  /** Go to the network now. The member's pull, or the caller's own mutation. */
  refresh: () => Promise<void>;
  /** Replace the answer locally, for a caller that already knows the new one. */
  set: (value: T) => void;
}

export function useCachedView<T>(
  key: string,
  fetcher: () => Promise<{ ok: true; value: T } | { ok: false; error: string }>,
  opts: {
    /**
     * How old a snapshot may be before a mount refetches anyway. Default
     * `Infinity` — never, which is the owner's rule: only a pull refreshes.
     */
    maxAgeMs?: number;
    /** False while the caller is not ready to read yet (no session, no config). */
    enabled?: boolean;
  } = {},
): CachedView<T> {
  const { maxAgeMs = Number.POSITIVE_INFINITY, enabled = true } = opts;

  // 🔴 The first frame is the real page — see the note above.
  const initial = useRef(readAiViewCache<T>(key));
  const [data, setData] = useState<T | null>(initial.current?.value ?? null);
  const [loading, setLoading] = useState(() => enabled && initial.current === null);
  const [error, setError] = useState<string | null>(null);
  /* One flight at a time: a pull during a refresh must not start a second. */
  const inFlight = useRef(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    const res = await fetcherRef.current();
    inFlight.current = false;
    setLoading(false);
    if (res.ok) {
      setData(res.value);
      setError(null);
      writeAiViewCache(key, res.value);
    } else {
      setError(res.error);
      /*
        A failed refresh keeps whatever was already on screen. A member who
        pulled to refresh on a flaky train should not have their page emptied
        for the trouble.
      */
    }
  }, [key]);

  /* The only automatic fetch: nothing remembered, or what is remembered is too old. */
  useEffect(() => {
    if (!enabled) return;
    const snapshot = initial.current;
    const stale = !snapshot || Date.now() - snapshot.at > maxAgeMs;
    if (stale) void run();
  }, [enabled, maxAgeMs, run]);

  /* The member's pull, from anywhere in the tree. */
  useEffect(() => {
    if (!enabled) return;
    const onRefresh = () => void run();
    window.addEventListener(AI_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(AI_REFRESH_EVENT, onRefresh);
  }, [enabled, run]);

  const set = useCallback(
    (value: T) => {
      setData(value);
      writeAiViewCache(key, value);
    },
    [key],
  );

  return { data, loading, error, refresh: run, set };
}
