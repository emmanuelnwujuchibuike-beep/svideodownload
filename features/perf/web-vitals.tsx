"use client";

import { useReportWebVitals } from "next/web-vitals";
import { useEffect } from "react";

/**
 * Cheap, synchronous device-capability context attached to every vitals
 * beacon — measurement only, changes nothing about how the app behaves.
 * "Never optimize based on assumptions alone" (Part 13's own rule): before
 * any device-tier-aware behavior change is worth building, there needs to
 * be real production data showing which conditions actually correlate with
 * bad scores. This is that data collection, not a decision engine.
 */
function deviceContext(): { cores?: number; memGb?: number; conn?: string } {
  const nav = navigator as unknown as {
    hardwareConcurrency?: number;
    deviceMemory?: number;
    connection?: { effectiveType?: string };
  };
  return {
    cores: nav.hardwareConcurrency,
    memGb: nav.deviceMemory, // Chrome/Edge/Android only
    conn: nav.connection?.effectiveType, // Chrome/Edge/Android only
  };
}

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
        ...deviceContext(),
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
