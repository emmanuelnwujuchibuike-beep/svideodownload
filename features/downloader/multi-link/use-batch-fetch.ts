"use client";

import { useCallback, useEffect, useRef } from "react";

import { sourceUrlSchema } from "@/lib/validation";
import type { ApiError, VideoMetadata } from "@/types";

import type { BatchAction, BatchSource } from "./state";

/**
 * Source extraction with controlled concurrency (§10), request dedup and real
 * cancellation (§31, §32).
 *
 * ── Why not just `Promise.all(sources.map(fetch))` ────────────────────────
 * Six simultaneous extractions of six different links is six yt-dlp processes
 * and six platform round trips fired at once, from one visitor. The platforms
 * rate-limit on exactly that shape — it is the same mistake the download
 * manager already had to fix ("batch always shows failed", features/downloads/
 * manager.ts's own MAX_CONCURRENT gate). The default of 2 is admin-tunable via
 * `fetchConcurrency`; the point is that it is bounded, not what the number is.
 *
 * ── Cancellation actually cancels ─────────────────────────────────────────
 * Every in-flight request holds an `AbortController` in a ref keyed by source
 * id. Removing a source, editing its URL, or unmounting the panel aborts it —
 * so a closed panel is not still holding six extractions open server-side, and
 * a result that lands after its source is gone cannot dispatch into a tree
 * that no longer has a place for it.
 */

const FETCH_TIMEOUT_MS = 45_000;

export function useBatchFetch(
  dispatch: (a: BatchAction) => void,
  concurrency: number,
  onDiscovered?: (sourceId: string, count: number) => void,
) {
  const controllers = useRef(new Map<string, AbortController>());
  /** Normalized URLs already fetched in this session, and their result — a
   *  re-render, a "Fetch all" over an already-fetched source, or the same link
   *  in two slots must not re-extract (§31: no duplicate requests). */
  const seen = useRef(new Map<string, VideoMetadata>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    /*
      Captured into a local so the cleanup closes over the SAME Map this effect
      saw, not whatever `controllers.current` happens to point at when the
      cleanup eventually runs (what react-hooks/exhaustive-deps warns about).
      It is a `useRef` initialised once and never reassigned, so the two are the
      same object today — capturing keeps that true if it ever stops being.
    */
    const inFlight = controllers.current;
    return () => {
      mounted.current = false;
      for (const c of inFlight.values()) c.abort();
      inFlight.clear();
    };
  }, []);

  const cancel = useCallback((sourceId: string) => {
    controllers.current.get(sourceId)?.abort();
    controllers.current.delete(sourceId);
  }, []);

  const fetchSource = useCallback(
    async (source: BatchSource): Promise<void> => {
      const parsed = sourceUrlSchema.safeParse(source.url);
      if (!parsed.success) {
        dispatch({
          type: "fetchError",
          sourceId: source.id,
          message: parsed.error.issues[0]?.message ?? "Please enter a valid supported link.",
        });
        return;
      }
      const url = parsed.data;

      // Already extracted this exact link in this session — reuse it rather
      // than paying for the same extraction twice.
      const cached = seen.current.get(url);
      if (cached) {
        dispatch({ type: "fetchSuccess", sourceId: source.id, metadata: cached });
        onDiscovered?.(source.id, cached.formats.length);
        return;
      }

      cancel(source.id);
      const controller = new AbortController();
      controllers.current.set(source.id, controller);
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      dispatch({ type: "fetchStart", sourceId: source.id });

      try {
        const res = await fetch("/api/metadata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
          signal: controller.signal,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json?.ok === false || !json?.data) {
          const err = json as ApiError;
          dispatch({
            type: "fetchError",
            sourceId: source.id,
            // The server's own explanation when it gave one — it knows whether
            // the post was private, region-locked or simply an image, and
            // replacing that with a generic string is how "we couldn't fetch
            // this" becomes unactionable.
            message: err?.error ?? "We couldn't fetch this source. Try again.",
          });
          return;
        }
        const metadata = json.data as VideoMetadata;
        if (metadata.formats.length === 0) {
          dispatch({
            type: "fetchError",
            sourceId: source.id,
            message: "No downloadable content was found from this source.",
          });
          return;
        }
        seen.current.set(url, metadata);
        if (!mounted.current) return;
        dispatch({ type: "fetchSuccess", sourceId: source.id, metadata });
        onDiscovered?.(source.id, metadata.formats.length);
      } catch (e) {
        // An abort is a deliberate cancellation, never an error to report.
        if (controller.signal.aborted || !mounted.current) return;
        dispatch({
          type: "fetchError",
          sourceId: source.id,
          message:
            e instanceof Error && e.name === "AbortError"
              ? "That source took too long. Try again."
              : "We couldn't fetch this source. Try again.",
        });
      } finally {
        clearTimeout(timer);
        controllers.current.delete(source.id);
      }
    },
    [dispatch, cancel, onDiscovered],
  );

  /**
   * Fetch many sources, at most `concurrency` at a time.
   *
   * A worker-pool rather than chunked `Promise.all` batches: with chunks, a
   * slow Telegram link (up to a minute — it is fetched over MTProto, not a
   * CDN) would hold its whole chunk hostage while a slot sat idle. Workers
   * pull the next source the moment they are free, which is what "process
   * completed sources immediately" (§10) actually requires.
   */
  const fetchAll = useCallback(
    async (sources: BatchSource[]): Promise<void> => {
      const queue = sources.filter((s) => s.url.trim() !== "" && s.status !== "fetching");
      if (queue.length === 0) return;
      let cursor = 0;
      const workers = Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, async () => {
        while (cursor < queue.length) {
          const next = queue[cursor++]!;
          await fetchSource(next);
        }
      });
      await Promise.all(workers);
    },
    [fetchSource, concurrency],
  );

  return { fetchSource, fetchAll, cancel };
}
