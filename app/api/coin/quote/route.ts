import { NextResponse } from "next/server";

import { marketRate } from "@/lib/ai/character-replace/fx-rate-server";
import { coinTransferFee, coinWithdrawalFee } from "@/lib/coin/config";
import { payoutPreview } from "@/lib/coin/payout-preview";
import { getLandingSettings } from "@/lib/landing/settings";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/coin/quote?kind=transfer|withdrawal&amountCents= — what a transfer or a withdrawal of this amount costs under
 * the admin's CURRENT audited rules (Part 5: the wallet's review step). Worked out on the server with the same integer
 * formula as the database (lib/coin/config.ts coinTransferFee / coinWithdrawalFee — the TypeScript twin of 0279's
 * coin_transfer_fee / coin_withdrawal_fee, pinned case-for-case in both test suites). A PREVIEW: the database prices
 * the operation again when it runs, and the receipt shows what it actually charged. Reads nothing about anyone.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const sp = new URL(request.url).searchParams;
  const kind = sp.get("kind");
  const raw = sp.get("amountCents") ?? "";
  const amount = /^\d{1,11}$/.test(raw) ? Number(raw) : NaN;
  if ((kind !== "transfer" && kind !== "withdrawal") || !Number.isSafeInteger(amount) || amount <= 0) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const c = (await getLandingSettings()).frenzCoin;
  const headers = { "cache-control": "private, no-store" };
  if (kind === "transfer") {
    const t = c.transfers;
    if (!c.enabled || !t.enabled) return NextResponse.json({ error: "Frenz Coin isn't available right now.", reason: "disabled" }, { status: 503 });
    if (amount < t.minCents || amount > t.maxCents) return NextResponse.json({ error: `Send between $${(t.minCents / 100).toFixed(2)} and $${(t.maxCents / 100).toFixed(2)}.`, reason: "amount_out_of_range" }, { status: 400 });
    const f = coinTransferFee(amount, t);
    return NextResponse.json({ kind, amountCents: amount, percentCents: f.percentCents, flatCents: f.flatCents, feeCents: f.feeCents, totalCents: f.totalDebitCents, bracket: f.bracket }, { headers });
  }
  const w = c.withdrawals;
  if (!c.enabled || !w.enabled) return NextResponse.json({ error: "Frenz Coin withdrawals aren't available right now.", reason: "disabled" }, { status: 503 });
  if (amount < w.minCents || amount > w.maxCents) return NextResponse.json({ error: `Withdraw between $${(w.minCents / 100).toFixed(2)} and $${(w.maxCents / 100).toFixed(2)}.`, reason: "amount_out_of_range" }, { status: 400 });
  const f = coinWithdrawalFee(amount, w);
  if (f.netCents <= 0) return NextResponse.json({ error: "That amount is too small to cover the withdrawal fee.", reason: "below_fee" }, { status: 400 });
  const payoutRateApproved = w.payoutRateSource !== "none" && (w.payoutRateSource !== "fixed" || !!w.payoutMinorPerUsd);
  /*
    Wallet setup (2026-10-26): the rate and the naira the member will receive, BEFORE they confirm — from the admin's
    audited settings (lib/coin/payout-preview.ts). A fixed rate is the exact amount the database will hold; a market
    rate (cached an hour) is an estimate, fixed when the payout is sent. Null when no rate is approved or available.
  */
  const market = payoutRateApproved && w.payoutRateSource === "market" ? await marketRate("NGN").catch(() => null) : null;
  const payout = payoutRateApproved ? payoutPreview(f.netCents, w, market?.rate.perUsd ?? null) : null;
  return NextResponse.json({ kind, grossCents: amount, feeCents: f.feeCents, netCents: f.netCents, percentBp: w.percentBp, flatCents: w.flatCents, payoutRateApproved, payout }, { headers });
}
