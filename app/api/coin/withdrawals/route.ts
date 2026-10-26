import { after, NextResponse } from "next/server";
import { z } from "zod";

import { authorizeCoinWithdrawal } from "@/lib/coin/authorization";
import { coinMemberLabel, notifyCoin, notifyCoinAdmins } from "@/lib/coin/notify";
import { resolveSavedBank } from "@/lib/coin/saved-banks";
import { requestCoinWithdrawal } from "@/lib/coin/server";
import { memberCoinWithdrawals } from "@/lib/coin/withdrawals";
import { getLandingSettings } from "@/lib/landing/settings";
import { aiJobCreateLimiter, clientId, pinLimiter } from "@/lib/rate-limit";
import { resolveAccount } from "@/lib/rewards/paystack-banks";
import { validatePayoutDetails } from "@/lib/rewards/withdrawals";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/coin/withdrawals — the signed-in member's own coin withdrawals (bank by name and last four digits only). */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const items = await memberCoinWithdrawals(user.id);
  if (!items) return NextResponse.json({ error: "Couldn't load your withdrawals." }, { status: 503 });
  return NextResponse.json({ items }, { headers: { "cache-control": "private, no-store" } });
}

const schema = z
  .object({
    grossCents: z.number().int().positive().max(100_000_000),
    bankCode: z.string().max(10),
    bankName: z.string().max(120),
    accountNumber: z.string().max(10),
    /**
     * Wallet setup (2026-10-26): one of the member's saved accounts (lib/coin/saved-banks.ts), by id. The server puts
     * the full number back from THEIR records; the three fields above are then ignored. Everything after is unchanged.
     */
    savedAccount: z.string().max(60).optional(),
    idempotencyKey: z.string().max(80),
    // the member's six-digit TRANSACTION PIN. Never logged, never stored, never echoed.
    pin: z.string().max(12),
  })
  .strict();

/**
 * POST /api/coin/withdrawals — withdraw Frenz Coins to a Nigerian bank account (closeout). The member is the session
 * and must have a CONFIRMED email; the bank account holder is named by the bank (Paystack's account lookup), never the
 * form; then the transaction PIN and the request are checked and held in ONE database transaction (0283
 * request_coin_withdrawal_with_pin): available → held, the fee (6%) taken FROM the gross, limits, one open at a time.
 * Nothing is paid here — an administrator approves and pays, through the existing payout rails. Validation happens
 * BEFORE the PIN attempt, so a typo never spends one.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!user.email_confirmed_at) return NextResponse.json({ error: "Confirm your email address before withdrawing.", reason: "email_unconfirmed" }, { status: 403 });
  const burst = await aiJobCreateLimiter.limit(`coin-withdraw:${user.id}`);
  if (!burst.success) return NextResponse.json({ error: "Too many requests — wait a moment." }, { status: 429 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const settings = await getLandingSettings();
  const c = settings.frenzCoin;
  if (!c.enabled || !c.withdrawals.enabled) return NextResponse.json({ error: "Frenz Coin withdrawals aren't available right now.", reason: "disabled" }, { status: 503 });
  let typed = { bankCode: parsed.data.bankCode, bankName: parsed.data.bankName, accountNumber: parsed.data.accountNumber };
  if (parsed.data.savedAccount) {
    const saved = await resolveSavedBank(user.id, parsed.data.savedAccount);
    if (!saved) return NextResponse.json({ error: "That saved account isn't available any more. Choose your bank again.", reason: "invalid_details" }, { status: 400 });
    typed = saved;
  }
  const details = validatePayoutDetails("paystack", typed);
  if (!details) return NextResponse.json({ error: "Check your bank details.", reason: "invalid_details" }, { status: 400 });
  // the money goes where the bank says the account is: the holder name comes from the bank, not from the form
  const accountName = await resolveAccount(details.accountNumber, details.bankCode ?? "");
  if (!accountName) return NextResponse.json({ error: "That account number doesn't match the bank. Check both.", reason: "account_mismatch" }, { status: 400 });
  const [byUser, byIp] = await Promise.all([pinLimiter.limit(`coin-pin:${user.id}`), pinLimiter.limit(`coin-pin-ip:${clientId(request.headers)}`)]);
  if (!byUser.success || !byIp.success) return NextResponse.json({ error: "Too many attempts — wait a moment.", reason: "rate_limited" }, { status: 429 });
  const auth = await authorizeCoinWithdrawal(user.id, parsed.data.pin, c);
  if (!auth.ok) {
    if (auth.reason === "unavailable") return NextResponse.json({ error: "Withdrawals aren't available right now. Nothing was held.", reason: "authorization_unavailable" }, { status: 503 });
    return NextResponse.json({ error: "That PIN wasn't accepted. Check it, or try again later. Nothing was held.", reason: "authorization_failed" }, { status: 403 });
  }
  const out = await requestCoinWithdrawal({
    userId: user.id,
    grossCents: parsed.data.grossCents,
    method: "paystack",
    details: { bankCode: details.bankCode ?? "", bankName: details.bankName, accountNumber: details.accountNumber, accountName },
    idempotencyKey: parsed.data.idempotencyKey,
    config: c,
    authorization: auth.authorization,
  });
  if (!out.ok) return NextResponse.json({ error: out.error, reason: out.reason }, { status: out.status });
  // after the commit, once (claim): "we received your request"
  if (!out.duplicate) {
    const net = `$${(out.netCents / 100).toFixed(2)}`;
    const gross = `${(out.grossCents / 100).toFixed(2)}`;
    const fee = `${(out.feeCents / 100).toFixed(2)}`;
    after(async () => {
      await notifyCoin(user.id, `coin-wd:${out.id}:requested`, "coin_withdrawal_update", { title: "Withdrawal requested", body: `Your Frenz Coin withdrawal is being reviewed. You'll receive ${net} after the fee.`, genericBody: "Your withdrawal request was received." }, { priority: "medium", email: { subject: `Withdrawal requested: ${gross} in Frenz Coin`, heading: "Withdrawal requested", intro: `We received your request to withdraw ${gross}. It's held while we review it; you'll receive ${net} after the ${fee} fee.`, body: `To ${details.bankName} ending ${details.accountNumber.slice(-4)}. Reference: ${out.id}` } });
      // Part 5: the admins — a request to review, and the fee it will earn
      const who = await coinMemberLabel(user.id);
      await notifyCoinAdmins(`coin-wd:${out.id}:requested`, user.id, { kind: "withdrawal_requested", title: `Coin withdrawal to review — ${gross}`, summary: `${who} asked to withdraw ${gross} (${net} to their bank)`, rows: [{ label: "Member", value: who }, { label: "Amount", value: gross }, { label: "To the member", value: net }, { label: "Bank", value: `${details.bankName} ••${details.accountNumber.slice(-4)}` }, { label: "Withdrawal", value: out.id }], feeCents: out.feeCents });
    });
  }
  return NextResponse.json({ ok: true, id: out.id, grossCents: out.grossCents, feeCents: out.feeCents, netCents: out.netCents, duplicate: out.duplicate }, { headers: { "cache-control": "no-store" } });
}
