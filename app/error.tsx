"use client";

import { ErrorFallback } from "@/features/app-shell/error-fallback";

/** Fallback for the marketing/SEO/downloader surfaces (landing, pricing,
 * blog, the [downloader] slug pages, …) that sit outside the (app) route
 * group and its own error boundary. */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorFallback
      error={error}
      reset={reset}
      secondaryHref="/"
      secondaryLabel="Go to homepage"
      logLabel="Page error:"
    />
  );
}
