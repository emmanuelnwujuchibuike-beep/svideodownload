import { NextResponse } from "next/server";

import { getLandingSettings } from "@/lib/landing/settings";
import { aiJobReadLimiter } from "@/lib/rate-limit";
import { buildQuestBoard } from "@/lib/rewards/quests";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/quests — the member's daily and weekly quests (0192): the operator's
 * list, this period's progress, what quests earned this week against the cap,
 * and when each period ends. ONE database call (`quest_status`). The quest page
 * keeps the answer and only asks again when it is stale, so an entry or a
 * back-swipe renders instantly with no reload.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const burst = await aiJobReadLimiter.limit(`quests:${user.id}`);
  if (!burst.success) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const [settings, status] = await Promise.all([getLandingSettings(), createAdminClient().rpc("quest_status", { p_user: user.id })]);
  const cfg = settings.frenzRewards.quests;
  if (status.error || !status.data) {
    // before 0192 is live: the list without progress, said as not started
    return NextResponse.json({ enabled: false, daily: [], weekly: [], weeklyCreditCap: cfg.weeklyCreditCap, weekEarned: 0, dayEndsAt: null, weekEndsAt: null }, { headers: { "cache-control": "no-store" } });
  }
  const board = buildQuestBoard(cfg, status.data as Parameters<typeof buildQuestBoard>[1]);
  return NextResponse.json({ ...board, enabled: board.enabled && settings.frenzRewards.enabled }, { headers: { "cache-control": "no-store" } });
}
