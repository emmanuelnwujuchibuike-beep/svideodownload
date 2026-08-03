"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Fires a `page_view` on every route change (and, inside track(), a `session_start`
 * whenever a new 30-minute session opens). Mounted once in the root layout.
 *
 * Passive by design — it only READS `usePathname` and fires an effect; it never
 * patches history/pushState or observes <html>, so it can't break App Router
 * prefetch or instant navigation (see the "never add global runtime that touches
 * navigation" rule).
 *
 * The collector (`lib/analytics/client` — visitor/session IDs, batching, beacons)
 * is loaded with a DYNAMIC import inside the effect, so it is code-split OFF every
 * page's first-load JS. That keeps it out of the landing's cold-entry budget (the
 * 2-second rule): the module fetches after hydration, and the first page_view is
 * itself queued on a 3s debounce, so nothing about the timing changes — but the
 * ~1 kB collector no longer rides the critical path on a first visit from search.
 */
export function AnalyticsTracker() {
  const pathname = usePathname();
  useEffect(() => {
    let cancelled = false;
    void import("@/lib/analytics/client").then((m) => {
      if (!cancelled) m.trackPageView();
    });
    return () => {
      cancelled = true;
    };
  }, [pathname]);
  return null;
}
