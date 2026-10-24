"use client";

import dynamic from "next/dynamic";

/** Admin → Flutterwave (keys, connection test, payments & reconciliation), fetched only when its tab renders — kept off /admin's first-load budget. */
export const FlutterwaveSettingsLazy = dynamic(() => import("./flutterwave-settings").then((m) => m.FlutterwaveSettings), {
  ssr: false,
  loading: () => <p className="mb-6 text-xs text-muted-foreground">Loading Flutterwave…</p>,
});
