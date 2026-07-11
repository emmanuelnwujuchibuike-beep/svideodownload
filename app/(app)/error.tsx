"use client";

import { ErrorFallback } from "@/features/app-shell/error-fallback";

/** Fallback for every signed-in app route that doesn't define its own
 * (reels, messages, friends, notifications, search, downloads, saved,
 * account, …) — before this, an unhandled error anywhere in those trees
 * fell through to Next's default unbranded crash screen. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorFallback
      error={error}
      reset={reset}
      secondaryHref="/home"
      secondaryLabel="Go home"
      logLabel="App route error:"
    />
  );
}
