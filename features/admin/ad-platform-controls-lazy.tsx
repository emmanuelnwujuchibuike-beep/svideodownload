"use client";

import dynamic from "next/dynamic";

/** The Part 7 self-serve rules, fetched only when /admin renders the Ads panel — off its first-load budget. */
export const AdPlatformControlsLazy = dynamic(() => import("./ad-platform-controls").then((m) => m.AdPlatformControls), {
  ssr: false,
  loading: () => <p className="text-xs text-muted-foreground">Loading…</p>,
});
