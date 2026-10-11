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

  const db = createAdminClient();
  // 2026-10-11 redesign: the balance rides along in the SAME wave (one primary-key row, read
  // exactly as lib/rewards/summary.ts reads it), so the Earn credits hero needs no second request
  const [settings, status, purse] = await Promise.all([
    getLandingSettings(),
    db.rpc("quest_status", { p_user: user.id }),
    db.from("ai_product_balances").select("balance_cents, withdrawable_cents, currency").eq("user_id", user.id).eq("product", "character_replace").maybeSingle(),
  ]);
  const cfg = settings.frenzRewards.quests;
  const wallet = walletOf(purse);
  if (status.error || !status.data) {
    // before 0192 is live: the list without progress, said as not started
    return NextResponse.json({ enabled: false, daily: [], weekly: [], weeklyCreditCap: cfg.weeklyCreditCap, weekEarned: 0, dayEndsAt: null, weekEndsAt: null, wallet }, { headers: { "cache-control": "no-store" } });
  }
  const board = buildQuestBoard(cfg, status.data as Parameters<typeof buildQuestBoard>[1]);
  return NextResponse.json({ ...board, enabled: board.enabled && settings.frenzRewards.enabled, wallet }, { headers: { "cache-control": "no-store" } });
}

/** Display only — null when the read failed (the page says so instead of showing a made-up zero). No wallet row yet is a real 0. */
function walletOf(r: { data: unknown; error: unknown }): { credits: number; withdrawable: number } | null {
  if (r.error) return null;
  const w = r.data as { balance_cents: number; withdrawable_cents: number | null; currency: string } | null;
  if (!w || w.currency !== "CREDIT") return { credits: 0, withdrawable: 0 };
  return { credits: Math.max(0, Number(w.balance_cents)), withdrawable: Math.max(0, Number(w.withdrawable_cents ?? 0)) };
}
