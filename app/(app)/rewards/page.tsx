import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RewardsPage } from "@/features/rewards/rewards-page";
import { getLandingSettings } from "@/lib/landing/settings";
import { loadRewardsSummary } from "@/lib/rewards/summary";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Rewards", robots: { index: false, follow: false } };

/**
 * /rewards — the member's rewards and referrals (owner brief 2026-10-07 §7–§11).
 * Read on the server in one parallel wave (lib/rewards/summary.ts — the same
 * read as /api/rewards/summary), so the page opens with its numbers instead of
 * a spinner and a second round trip. Display only: every decision that moves
 * credits is made again by the API that does it.
 */
export default async function Rewards() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/rewards");
  const settings = await getLandingSettings();
  const summary = await loadRewardsSummary(user.id, settings.frenzRewards);
  return <RewardsPage summary={summary} />;
}
