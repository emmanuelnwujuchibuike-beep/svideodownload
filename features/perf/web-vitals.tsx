"use client";

import { useReportWebVitals } from "next/web-vitals";
import { useEffect } from "react";

/**
 * Continuous performance monitoring. Reports Core Web Vitals (LCP, CLS, INP,
 * FCP, TTFB) — in development they're logged to the console; in production a
 * small sample is beaconed to /api/vitals (visible in server logs) so real-user
 * regressions surface without a heavyweight analytics dependency. Also watches
 * for long tasks (>50ms main-thread blocks) in development.
 */
export function WebVitals() {
  useReportWebVitals((metric) => {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.log(`[vitals] ${metric.name}: ${Math.round(metric.value)} (${metric.rating ?? "?"})`);
      return;
    }
    // Sample ~15% of sessions to keep the signal cheap.
    if (Math.random() > 0.15) return;
    try {
      const body = JSON.stringify({
        name: metric.name,
        value: Math.round(metric.value),
        rating: metric.rating,
        path: window.location.pathname,
      });
      navigator.sendBeacon?.("/api/vitals", body);
    } catch {
      /* never let monitoring throw */
    }
  });

  // Long-task visibility (dev only) — surfaces main-thread jank while building.
  useEffect(() => {
    if (process.env.NODE_ENV === "production" || typeof PerformanceObserver === "undefined") return;
    let obs: PerformanceObserver | null = null;
    try {
      obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration > 80) {
            // eslint-disable-next-line no-console
            console.warn(`[longtask] ${Math.round(entry.duration)}ms blocked the main thread`);
          }
        }
      });
      obs.observe({ entryTypes: ["longtask"] });
    } catch {
      /* longtask not supported */
    }
    return () => obs?.disconnect();
  }, []);

  return null;
}
