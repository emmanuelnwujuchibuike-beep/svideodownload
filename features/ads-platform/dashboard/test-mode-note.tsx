"use client";

import { useEffect, useState } from "react";

import { loadBoosts } from "./dashboard-data";

/**
 * 0211: shown above the figures when an admin has put a campaign in test mode,
 * so boosted numbers are never read as measured ones. Renders nothing otherwise
 * (and when the read fails).
 */
export function TestModeNote({ campaignId }: { campaignId?: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    void loadBoosts().then((m) => alive && setOn(campaignId ? m.has(campaignId) : m.size > 0));
    return () => {
      alive = false;
    };
  }, [campaignId]);
  if (!on) return null;
  return (
    <p role="note" className="rounded-xl bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-900">
      Test mode: {campaignId ? "this campaign's" : "some campaigns'"} views, clicks and conversions are shown ×10 for testing. Billing is unaffected.
    </p>
  );
}
