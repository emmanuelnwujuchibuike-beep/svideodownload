"use client";

import dynamic from "next/dynamic";

/** Part 3 delivery monitor, fetched only when the Ads panel renders — off /admin's first-load budget. */
export const AdDeliveryMonitorLazy = dynamic(() => import("./ad-delivery-monitor").then((m) => m.AdDeliveryMonitor), {
  ssr: false,
  loading: () => <p className="text-xs text-muted-foreground">Loading…</p>,
});
