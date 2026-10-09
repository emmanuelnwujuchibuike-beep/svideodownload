"use client";

import dynamic from "next/dynamic";

/** The Part 8 Traffic & safety centre, fetched only when /admin renders the Ads panel — off its first-load budget. */
export const AdSafetyCenterLazy = dynamic(() => import("./ad-safety-center").then((m) => m.AdSafetyCenter), {
  ssr: false,
  loading: () => <p className="text-xs text-muted-foreground">Loading…</p>,
});
