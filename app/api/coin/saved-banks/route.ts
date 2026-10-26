import { NextResponse } from "next/server";

import { listSavedBanks } from "@/lib/coin/saved-banks";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/coin/saved-banks — the signed-in member's saved bank accounts for a coin withdrawal (Wallet setup,
 * 2026-10-26): their verified SUB payout account and the banks of their own earlier withdrawals. Bank, holder name and
 * last four digits only — a withdrawal names one by id and the server puts the number back (lib/coin/saved-banks.ts).
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  return NextResponse.json({ banks: await listSavedBanks(user.id) }, { headers: { "cache-control": "private, no-store" } });
}
