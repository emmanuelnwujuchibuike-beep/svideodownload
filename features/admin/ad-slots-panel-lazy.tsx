"use client";

import dynamic from "next/dynamic";

/** The slot table, fetched only when the Ad placements tab renders — kept off /admin's first-load budget. */
export const AdSlotsPanelLazy = dynamic(() => import("./ad-slots-panel").then((m) => m.AdSlotsPanel), {
  ssr: false,
  loading: () => <p className="mb-6 text-xs text-muted-foreground">Loading slots…</p>,
});
