"use client";

import dynamic from "next/dynamic";

/** The campaign-length switches, fetched only when the Ad placements tab renders — kept off /admin's first-load budget. */
export const AdDurationsPanelLazy = dynamic(() => import("./ad-durations-panel").then((m) => m.AdDurationsPanel), {
  ssr: false,
  loading: () => <p className="mb-6 text-xs text-muted-foreground">Loading campaign lengths…</p>,
});
