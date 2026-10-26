import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { adminCoinWithdrawals } from "@/lib/coin/withdrawals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — Frenz Coin withdrawals for the admin (closeout): open ones first (pending, reviewing, approved, processing),
 * then recent finished ones, each with gross / fee / net, the recorded naira payout and the payout reference. The
 * actions are the existing withdrawal routes — review / approve / reject via POST /api/admin/rewards/withdrawals/[id]
 * and pay via POST /api/admin/rewards/withdrawals/[id]/paystack — all with a fresh password and audited; they dispatch a
 * coin withdrawal to its own accounting (0279). A coin payout needs an approved naira rate (frenzCoin.withdrawals.payoutRateSource).
 */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const out = await adminCoinWithdrawals(100);
  if (!out) return NextResponse.json({ error: "Couldn't load them." }, { status: 503 });
  return NextResponse.json(out, { headers: { "Cache-Control": "private, no-store" } });
}
