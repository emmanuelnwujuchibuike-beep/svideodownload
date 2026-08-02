"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { trackPageView } from "@/lib/analytics/client";

/**
 * Fires a `page_view` on every route change (and, inside track(), a `session_start`
 * whenever a new 30-minute session opens). Mounted once in the root layout.
 *
 * Passive by design — it only READS `usePathname` and fires an effect; it never
 * patches history/pushState or observes <html>, so it can't break App Router
 * prefetch or instant navigation (see the "never add global runtime that touches
 * navigation" rule). The event itself is queued and flushed on a 3s debounce, well
 * after LCP, so it never competes with the landing page's cold-open budget.
 */
export function AnalyticsTracker() {
  const pathname = usePathname();
  useEffect(() => {
    trackPageView();
  }, [pathname]);
  return null;
}
