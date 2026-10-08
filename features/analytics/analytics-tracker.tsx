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
/**
 * The discovery doors (Landing + Download brief §34, owner 2026-10-08). A link
 * carrying `data-track="<event>"` reports one event when tapped — ONE delegated,
 * passive listener for the whole app, instead of code on every link. It only
 * reads the tap: it never prevents or delays the navigation. Only these names
 * pass, so a stray attribute cannot invent an event type.
 */
export const DISCOVERY_EVENTS = ["ai_clicked", "reels_clicked", "ai_reels_clicked", "wallpapers_clicked", "advertise_clicked"] as const;
type DiscoveryEvent = (typeof DISCOVERY_EVENTS)[number];
const isDiscoveryEvent = (v: string | undefined): v is DiscoveryEvent => !!v && (DISCOVERY_EVENTS as readonly string[]).includes(v);

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

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-track]") as HTMLElement | null;
      const type = el?.dataset.track;
      if (!isDiscoveryEvent(type)) return;
      const from = window.location.pathname;
      const href = el?.getAttribute("href") ?? null;
      // batched by the collector like every other event; the tap itself is untouched
      void import("@/lib/analytics/client").then((m) => m.track(type, { from, href }));
    };
    document.addEventListener("click", onClick, { capture: true, passive: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);
  return null;
}
