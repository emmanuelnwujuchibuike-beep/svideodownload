"use client";

import dynamic from "next/dynamic";

/** The Part 7 review desk, fetched only when /admin renders the Ads panel — off its first-load budget. */
export const AdCampaignsDeskLazy = dynamic(() => import("./ad-campaigns-desk").then((m) => m.AdCampaignsDesk), {
  ssr: false,
  loading: () => <p className="text-xs text-muted-foreground">Loading…</p>,
});
