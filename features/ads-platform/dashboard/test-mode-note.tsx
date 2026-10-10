"use client";

import { useEffect, useState } from "react";

import { getClient } from "@/lib/supabase/client-lazy";

import { loadBoosts } from "./dashboard-data";

/**
 * 0212: shown above the figures when an admin has put a campaign in test mode,
 * so boosted numbers are never read as measured ones by an advertiser.
 *
 * 2026-10-09 (owner): an admin looking at their own dashboard doesn't need the
 * label — they switched the ×10 on themselves. Every other viewer still sees
 * it: boosted figures shown to a paying advertiser without it would be a
 * fabricated statistic (AGENTS.md, the truth rule). If the admin check fails,
 * the label shows.
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
  return (
    <p role="note" className="w-fit rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
      Sample data
    </p>
  );
}

async function viewerIsAdmin(): Promise<boolean> {
  try {
    const sb = await getClient();
    const { data, error } = await sb.rpc("is_admin");
    return !error && data === true;
  } catch {
    return false;
  }
}
