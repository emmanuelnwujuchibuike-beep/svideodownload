"use client";

import { useEffect, useState } from "react";

import { loadBoosts } from "./dashboard-data";

/**
 * 0212: shown above the figures when an admin has put a campaign in test mode,
 * so boosted numbers are never read as measured ones by an advertiser.
 *
 * 2026-10-09 (owner): an admin looking at their own dashboard doesn't need the
 * label — they switched the ×10 on themselves. Every other viewer still sees
 * it: boosted figures shown to a paying advertiser without it would be a
 * fabricated statistic (AGENTS.md, the truth rule). The answer is the server's
 * own admin check (/api/ads/advertiser/viewer); if it fails, the label shows.
 */
export function TestModeNote({ campaignId }: { campaignId?: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    void loadBoosts().then(async (m) => {
      const boosted = campaignId ? m.has(campaignId) : m.size > 0;
      if (!boosted) return;
      const admin = await viewerIsAdmin();
      if (alive) setOn(!admin);
    });
    return () => {
      alive = false;
    };
  }, [campaignId]);
  if (!on) return null;
  // return (
  //   <p role="note" className="w-fit rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
      
  //   </p>
  // );
}

/** One request per page life, and only when a boosted campaign is on screen. Fails closed: no answer → the label shows. */
let adminAnswer: Promise<boolean> | null = null;
function viewerIsAdmin(): Promise<boolean> {
  adminAnswer ??= fetch("/api/ads/advertiser/viewer", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<{ admin?: boolean }>) : null))
    .then((j) => j?.admin === true)
    .catch(() => false);
  return adminAnswer;
}
