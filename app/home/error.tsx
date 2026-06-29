"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

/** Error boundary for the home dashboard. */
export default function HomeError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surface to the console for diagnostics; wire to Sentry/etc. when available.
    console.error("Home dashboard error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10 text-red-500">
        <AlertTriangle className="h-7 w-7" />
      </span>
      <h1 className="text-xl font-bold">Something went wrong</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        We couldn&apos;t load your home feed. Please try again — if it keeps happening, refresh the page.
      </p>
      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:opacity-95"
        >
          Try again
        </button>
        <Link href="/explore" className="rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-semibold transition hover:bg-secondary">
          Go to Explore
        </Link>
      </div>
    </div>
  );
}
