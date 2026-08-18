"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { logError } from "@/lib/observability/log-error";

/**
 * 🔴 A stale tab's #1 source of "something went wrong" (owner report: the
 * comment sheet in BOTH feed and reels — two unrelated features whose only
 * common thread is that each lazy-loads its comments UI via `next/dynamic`,
 * see reel-viewer.tsx and feed-post-card.tsx). Every deploy ships new chunk
 * hashes; a tab left open from before the deploy still has the OLD manifest,
 * so the first `import()` for a not-yet-visited chunk (comments is opened on
 * demand, never on initial load) 404s. That throws mid-render, the nearest
 * `error.tsx` catches it, and both feed/reels fall through to the SAME
 * `app/(app)/error.tsx` — matching the identical wording in both places.
 * `reset()` alone can't fix this: it re-renders the segment against the
 * SAME stale manifest already in memory, so it fails again identically.
 * Only a real navigation (fetching a fresh HTML document + manifest) does.
 */
function isChunkLoadError(error: Error): boolean {
  return (
    error.name === "ChunkLoadError" ||
    /loading chunk|loading css chunk|failed to fetch dynamically imported module|importing a module script failed/i.test(
      error.message ?? "",
    )
  );
}

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
  // One silent auto-reload per stale tab, not a loop — a session flag survives
  // the reload itself (sessionStorage, not a plain ref) so a genuinely broken
  // deploy shows the real error screen on the second hit instead of refreshing
  // forever. Cleared naturally on tab close, so the next visit gets a fresh try.
  const [autoRecovering, setAutoRecovering] = useState(false);

  useEffect(() => {
    logError(logLabel, error);
  }, [error, logLabel]);

  useEffect(() => {
    if (!chunkError) return;
    const key = "frenz:chunk-error-reload";
    if (sessionStorage.getItem(key)) return; // already tried once this tab — show the real screen
    sessionStorage.setItem(key, "1");
    setAutoRecovering(true);
    window.location.reload();
  }, [chunkError]);

  if (autoRecovering) return null; // reloading — nothing to flash on screen

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10 text-red-500">
        <AlertTriangle className="h-7 w-7" />
      </span>
      <h1 className="text-xl font-bold">{chunkError ? "A new version is ready" : title}</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        {chunkError ? "This tab was open before an update. Refresh to pick it up." : message}
      </p>
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
