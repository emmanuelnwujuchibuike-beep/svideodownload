import { NextResponse } from "next/server";

import { getLandingSettings } from "@/lib/landing/settings";
import { aiJobReadLimiter } from "@/lib/rate-limit";
import { loadRewardsSummary } from "@/lib/rewards/summary";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/rewards/summary — the member's own rewards, classes, qualification, referrals and withdrawals (lib/rewards/summary.ts). */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const burst = await aiJobReadLimiter.limit(`rewards-summary:${user.id}`);
  if (!burst.success) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  try {
    const settings = await getLandingSettings();
    return NextResponse.json(await loadRewardsSummary(user.id, settings.frenzRewards), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[rewards/summary] failed", { userId: user.id, error: String(e).slice(0, 200) });
    return NextResponse.json({ error: "Couldn't load your rewards." }, { status: 503 });
  }
}
