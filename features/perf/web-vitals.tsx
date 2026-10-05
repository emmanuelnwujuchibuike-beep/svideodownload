"use client";

import { useReportWebVitals } from "next/web-vitals";
import { useEffect } from "react";

import { parseSampleRate } from "@/lib/perf/sample-rate";

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
/**
 * The loader's own timing, written by public/launch.html on a cold entry
 * (see the note there) and sent once per sampled document. It was un-sampled
 * ("one beacon per app open is nothing") until 2026-10-05: one per app open is
 * one invocation + one log event per app open, so it now rides the same
 * `NEXT_PUBLIC_VITALS_SAMPLE` switch as everything else here (default off).
 *   `LAUNCH=<responseStart ms> <good|needs-improvement|poor> /launch.html
 *    ws=<workerStart ms|0> ts=<bytes|0 = cache> type=<navigate|reload> age=<ms since>`
 */
function beaconLaunchTiming() {
  try {
    const raw = sessionStorage.getItem("frenz:launch-timing");
    if (!raw) return;
    sessionStorage.removeItem("frenz:launch-timing");
    const t = JSON.parse(raw) as { ws?: number; rs?: number; ts?: number; type?: string; at?: number };
    if (typeof t.rs !== "number") return;
    const body = JSON.stringify({
      name: "LAUNCH",
      value: t.rs,
      rating: t.rs < 300 ? "good" : t.rs < 1000 ? "needs-improvement" : "poor",
      path: "/launch.html",
      launch: { ws: t.ws ?? 0, ts: t.ts ?? 0, type: t.type ?? "?", age: t.at ? Date.now() - t.at : null },
      ...deviceContext(),
    });
    navigator.sendBeacon?.("/api/vitals", body);
  } catch {
    /* never let monitoring throw */
  }
}

/**
 * ⛔ OFF BY DEFAULT — the beacon is a per-pageview billing tap (owner,
 * 2026-10-05: "nothing should EVER consume Vercel unless a user has clicked").
 *
 * It sampled 15% per METRIC, and a page reports ~5 metrics (LCP, CLS, INP,
 * FCP, TTFB), so it averaged ~0.75 beacons per page view. Each one is an edge
 * invocation AND a `console.log` in /api/vitals — one Observability event per
 * page view, which is the per-request-log rule broken by monitoring itself.
 * Same fix as the CSP report-only tap (`CSP_REPORT_URI`): measurement is a
 * switch an operator turns on for a window, not a standing cost.
 *
 * `NEXT_PUBLIC_VITALS_SAMPLE` = the share of PAGE VIEWS (0–1) that report.
 * Unset, empty, malformed or out of range ⇒ 0. Decided ONCE per document, so a
 * sampled page view reports all its metrics and an unsampled one sends none.
 */
export function vitalsSampleRate(raw: string | undefined): number {
  return parseSampleRate(raw);
}

const SAMPLE_RATE = vitalsSampleRate(process.env.NEXT_PUBLIC_VITALS_SAMPLE);
/** Module scope = once per document, never per metric. */
const SAMPLED = SAMPLE_RATE > 0 && Math.random() < SAMPLE_RATE;

export function WebVitals() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && SAMPLED) beaconLaunchTiming();
  }, []);
  useReportWebVitals((metric) => {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.log(`[vitals] ${metric.name}: ${Math.round(metric.value)} (${metric.rating ?? "?"})`);
      return;
    }
    if (!SAMPLED) return;
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
