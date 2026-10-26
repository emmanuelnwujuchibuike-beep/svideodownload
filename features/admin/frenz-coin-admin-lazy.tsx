"use client";

import dynamic from "next/dynamic";

/** Frenz Coin Part 6: the coin console, fetched only when /admin renders the Frenz Coin panel — off its first-load budget. */
export const FrenzCoinAdminLazy = dynamic(() => import("./frenz-coin/coin-admin-console").then((m) => m.CoinAdminConsole), {
  ssr: false,
  loading: () => <p className="text-xs text-muted-foreground">Loading…</p>,
});
