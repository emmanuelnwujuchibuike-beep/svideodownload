import { NextResponse } from "next/server";

import { coinWalletSummary } from "@/lib/coin/wallet";
import { getLandingSettings } from "@/lib/landing/settings";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/coin/wallet — the signed-in member's Frenz Coin wallet (Part 4): available, pending, held and total, the
 * deposits still on hold with their release times, and what the wallet can do right now. Their own wallet only.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const settings = await getLandingSettings();
  const out = await coinWalletSummary(user.id, settings.frenzCoin);
  if (!out) return NextResponse.json({ error: "Couldn't load your wallet." }, { status: 503 });
  return NextResponse.json(out, { headers: { "cache-control": "private, no-store" } });
}
