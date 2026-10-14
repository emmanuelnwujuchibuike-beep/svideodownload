"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { logError } from "@/lib/observability/log-error";
import { BAKED_APP_BUILD, fetchServerBuild } from "@/lib/pwa/app-version";

import { CHUNK_RELOAD_KEY, isChunkLoadError, isNewDeploy, shouldAutoReload } from "./chunk-error";

/*
 * 🔴 A stale tab's #1 source of "something went wrong": every deploy ships new
 * chunk hashes, and a tab opened before the deploy 404s on the first lazy
 * `import()` (e.g. the comments sheet in feed and reels). `reset()` can't fix
 * that because it re-renders against the same stale manifest. Only a real
 * reload does. The same error also comes from a plain network drop (an iOS
 * resume), so see ./chunk-error.ts for how the two are told apart.
 */

/**
 * Shared body for every route-segment `error.tsx` — before this only
 * `app/(app)/home/error.tsx` existed, so any unhandled render error anywhere
 * else in the app (reels, messages, friends, the marketing/downloader pages,
 * …) fell through to Next's default unbranded crash screen instead of a
 * recoverable, on-brand one. `reset()` re-renders the segment without a full
 * page reload — the boundary itself decides whether reload is a better
 * fallback (e.g. `global-error.tsx` uses it since the layout itself failed).
 */
export function ErrorFallback({
  error,
  reset,
  title = "Something went wrong",
  message = "That didn't load right. Please try again — if it keeps happening, refresh the page.",
  secondaryHref,
  secondaryLabel = "Go home",
  logLabel = "Route error:",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  message?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  logLabel?: string;
}) {
  const chunkError = isChunkLoadError(error);
  // One silent auto-reload per failure, guarded by a timestamp in sessionStorage
  // (it survives the reload), so a broken deploy shows the screen on the second
  // hit instead of refreshing forever.
  const [autoRecovering, setAutoRecovering] = useState(false);
  // "A new version is ready" only when the server confirms a different build.
  // Otherwise it was a connection blip (see chunk-error.ts).
  const [newDeploy, setNewDeploy] = useState(false);

  useEffect(() => {
    logError(logLabel, error);
  }, [error, logLabel]);

  useEffect(() => {
    if (!chunkError) return;
    // The fallback itself must never throw — a boundary that throws re-enters
    // the boundary. `sessionStorage` throws in a sandboxed embed (2026-09-13),
    // so a refused read means "do not auto-reload", and the real screen shows.
    let reload = false;
    try {
      reload = shouldAutoReload(sessionStorage.getItem(CHUNK_RELOAD_KEY), Date.now());
      if (reload) sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
    } catch {
      reload = false;
    }
    if (reload) {
      setAutoRecovering(true);
      // Offline (e.g. still waking from the background): reloading now would only
      // land on the offline page, so reload when the connection is back.
      if (navigator.onLine) {
        window.location.reload();
        return;
      }
      const onOnline = () => window.location.reload();
      window.addEventListener("online", onOnline, { once: true });
      return () => window.removeEventListener("online", onOnline);
    }
    let cancelled = false;
    void fetchServerBuild().then((server) => {
      if (!cancelled) setNewDeploy(isNewDeploy(BAKED_APP_BUILD, server));
    });
    return () => {
      cancelled = true;
    };
  }, [chunkError]);

  if (autoRecovering && navigator.onLine) return null; // reloading — nothing to flash on screen

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10 text-red-500">
        <AlertTriangle className="h-7 w-7" />
      </span>
      <h1 className="text-xl font-bold">{chunkError ? (newDeploy ? "A new version is ready" : autoRecovering ? "You're offline" : "Couldn't load this part") : title}</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        {chunkError
          ? newDeploy
            ? "This tab was open before an update. Refresh to pick it up."
            : autoRecovering
              ? "This will reload when you're back online."
              : "The connection dropped while it was loading. Refresh to try again."
          : message}
      </p>
      {/* 2026-10-09: a short code the owner can screenshot - the server digest, or the first words
          of a browser error - so a production failure can be traced without logs access */}
      {!chunkError ? (
        <p className="mt-2 font-mono text-[10.5px] text-muted-foreground/70" aria-label="Error code">
          {error.digest ? `ref ${error.digest}` : (error.message || error.name || "error").slice(0, 90)}
        </p>
      ) : null}
      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={chunkError ? () => window.location.reload() : reset}
          className="rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:opacity-95"
        >
          {chunkError ? "Refresh" : "Try again"}
        </button>
        {secondaryHref ? (
          <Link
            href={secondaryHref}
            className="rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-semibold transition hover:bg-secondary"
          >
            {secondaryLabel}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
