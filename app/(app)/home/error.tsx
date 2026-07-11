"use client";

import { ErrorFallback } from "@/features/app-shell/error-fallback";

/** Error boundary for the home dashboard. */
export default function HomeError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorFallback
      error={error}
      reset={reset}
      message="We couldn't load your home feed. Please try again — if it keeps happening, refresh the page."
      secondaryHref="/explore"
      secondaryLabel="Go to Explore"
      logLabel="Home dashboard error:"
    />
  );
}
