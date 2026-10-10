"use client";

import { useEffect, useState } from "react";

import { loadBoosts } from "./dashboard-data";

/**
 * 0212: shown above the figures when an admin has put a campaign in test mode,
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
    <p role="note" className="w-fit rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
      Sample data
    </p>
  );
}
