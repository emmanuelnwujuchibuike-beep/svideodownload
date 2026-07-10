"use client";

import { useEffect } from "react";

function report(name: string, value: number) {
  try {
    navigator.sendBeacon?.("/api/vitals", JSON.stringify({ name, value, path: window.location.pathname }));
  } catch {
    /* never let monitoring throw */
  }
}

/**
 * Scroll FPS + JS heap memory — the two Observability gaps Part 12's audit
 * confirmed had zero coverage (only video playback metrics + Core Web Vitals
 * existed). Same sampling/beacon contract as `WebVitals`: ~15% of production
 * sessions, fire-and-forget to the existing `/api/vitals` sink, no new
 * storage/service. Never a continuous rAF loop while idle — that would be a
 * real, pointless battery cost; frames are only counted DURING an actual
 * scroll burst, measured from the first scroll event to ~150ms after the
 * last one.
 */
export function ScrollPerfMonitor() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || Math.random() > 0.15) return;

    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    if (mem) report("memory-mb", Math.round(mem.usedJSHeapSize / 1_048_576));

    let frames = 0;
    let burstStart = 0;
    let rafId: number | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const tick = () => {
      frames++;
      rafId = requestAnimationFrame(tick);
    };

    const endBurst = () => {
      if (rafId === null) return;
      cancelAnimationFrame(rafId);
      rafId = null;
      const elapsed = performance.now() - burstStart;
      if (elapsed > 300) report("scroll-fps", Math.round((frames / elapsed) * 1000));
    };

    const onScroll = () => {
      if (rafId === null) {
        frames = 0;
        burstStart = performance.now();
        rafId = requestAnimationFrame(tick);
      }
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(endBurst, 150);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (idleTimer) clearTimeout(idleTimer);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  return null;
}
