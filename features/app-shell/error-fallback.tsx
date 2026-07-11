"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { logError } from "@/lib/observability/log-error";

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
  useEffect(() => {
    logError(logLabel, error);
  }, [error, logLabel]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10 text-red-500">
        <AlertTriangle className="h-7 w-7" />
      </span>
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">{message}</p>
      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:opacity-95"
        >
          Try again
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
