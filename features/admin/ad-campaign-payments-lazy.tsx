"use client";

import dynamic from "next/dynamic";

/**
 * The Campaign payments tab, fetched only when the admin page needs it - its
 * table and filters must not count against /admin's first-load budget
 * (lib/perf/budget.test.ts: 370 kB ceiling).
 */
export const AdCampaignPaymentsLazy = dynamic(() => import("./ad-campaign-payments").then((m) => m.AdCampaignPayments), {
  ssr: false,
  loading: () => <p className="text-xs text-muted-foreground">Loading…</p>,
});
