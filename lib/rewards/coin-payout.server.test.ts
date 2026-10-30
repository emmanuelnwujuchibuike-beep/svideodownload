import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Coin closeout — a coin withdrawal through the REAL Flutterwave payout rail (lib/rewards/flutterwave-payouts.ts)
 * and the REAL payout quote (lib/rewards/payout-quote.ts). Scripted: Flutterwave (no network), the market rate, and
 * record_coin_payout_quote modelled as 0283 writes it (once; a second call answers the first).
 * Pinned: no approved naira rate → nothing is approved, recorded or sent; the amount is the NET ($94 of a $100 gross)
 * at the approved rate; it is recorded before the transfer and a retry pays the recorded amount; AI-credit / SUB
 * payouts are worked out exactly as before.
 */
let db: FakeDb;
const W = "11111111-1111-4111-8111-111111111111";
let source: "none" | "fixed" | "market" = "none";
let fixedMinor: number | null = null;
let coinRail: "flutterwave" | "paystack" | "flutterwave_paystack_backup" | "by_country" = "by_country";
// the account holder Flutterwave reads for the bank details (a different name = a DEFINITE refusal: nothing is sent)
let fwName = "ADA OBI";
let perUsd = 1500;
const sent: number[] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/ai/character-replace/fx-rate-server", () => ({ marketRate: async () => ({ rate: { perUsd }, source: "stored" }) }));
vi.mock("@/lib/landing/settings", () => ({
  getLandingSettings: async () => ({ frenzRewards: { sub: { payoutProvider: "flutterwave" } }, frenzCoin: { payoutProvider: coinRail, withdrawals: { payoutRateSource: source, payoutMinorPerUsd: fixedMinor } } }),
}));
vi.mock("@/lib/flutterwave/config", () => ({ getFlutterwaveConfig: async () => ({ secretKey: "FLWSECK_TEST-x" }) }));
vi.mock("@/lib/flutterwave/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/flutterwave/client")>()),
  resolveFlutterwaveAccount: async () => fwName,
  createFlutterwaveTransfer: async (i: { amountMinor: number }) => (sent.push(i.amountMinor), { status: "NEW", id: "9" }),
}));
vi.mock("./paystack-payouts", () => ({ PAYSTACK_METHOD: "paystack", payWithdrawalViaPaystack: vi.fn(async () => ({ ok: false, error: "not used" })) }));
vi.mock("./withdrawals", () => ({
  resolveWithdrawal: async (i: { id: string; status: string; payoutReference?: string | null }) => {
    const row = db.tables.withdrawal_requests!.find((r) => r.id === i.id)!;
    row.status = i.status;
    if (i.payoutReference) row.payout_reference = i.payoutReference;
    return { ok: true };
  },
}));

// the quote is proven on the Flutterwave rail itself; which rail a coin payout takes is pinned at the end (2026-10-27)
const { payWithdrawal, payWithdrawalViaFlutterwave } = await import("./flutterwave-payouts");
const { payWithdrawalViaPaystack } = await import("./paystack-payouts");
const { payoutQuote } = await import("./payout-quote");
const row = () => db.tables.withdrawal_requests![0]!;
const coinRow = (over: Record<string, unknown> = {}) => ({ id: W, user_id: "u", source: "coin", status: "pending", payout_method: "paystack", payout_reference: null, gross_cents: 10_000, fee_cents: 600, net_cents: 9_400, amount_usd_cents: 9_400, payout_currency: null, payout_minor: null, payout_fx: null, payout_details: { bankCode: "058", accountNumber: "0123456789", accountName: "ADA OBI" }, updated_at: "2026-10-25T00:00:00Z", ...over });

beforeEach(() => {
  db = fakeDb({ withdrawal_requests: [coinRow()] });
  source = "none";
  fixedMinor = null;
  perUsd = 1500;
  fwName = "ADA OBI";
  sent.length = 0;
  // 0283 record_coin_payout_quote: written once; a second call answers what was recorded
  db.rpc.record_coin_payout_quote = vi.fn((a: Record<string, unknown>) => {
    const r = row();
    if (r.payout_minor) return { data: { ok: true, existing: true, payout_minor: r.payout_minor, payout_currency: r.payout_currency, payout_fx: r.payout_fx }, error: null };
    Object.assign(r, { payout_minor: a.p_minor, payout_currency: a.p_currency, payout_fx: a.p_fx });
    return { data: { ok: true, existing: false, payout_minor: a.p_minor, payout_currency: a.p_currency, payout_fx: a.p_fx }, error: null };
  });
});

describe("a Frenz Coin payout", () => {
  it("🔴 no approved naira rate (the default): refused — nothing approved, recorded or sent", async () => {
    const out = await payWithdrawalViaFlutterwave(W, "admin-1");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/approved naira rate/);
    expect(row().status).toBe("pending");
    expect(row().payout_reference).toBeNull();
    expect(db.rpc.record_coin_payout_quote).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });
  it("market rate: the NET ($94 of $100) at the live rate, no markup, recorded BEFORE the transfer", async () => {
    source = "market";
    const out = await payWithdrawalViaFlutterwave(W, "admin-1");
    expect(out.ok).toBe(true);
    expect(sent).toEqual([9_400 * 1500]);
    expect(row()).toMatchObject({ payout_minor: 14_100_000, payout_currency: "NGN", status: "processing", payout_reference: expect.stringMatching(/^frenz_fwd_/) });
    expect(row().payout_fx).toMatchObject({ source: "market", perUsd: 1500, netCents: 9_400 });
  });
  it("a retried payout pays the RECORDED amount even after the rate moved", async () => {
    source = "market";
    db.tables.withdrawal_requests = [coinRow({ status: "approved", payout_minor: 14_100_000, payout_currency: "NGN", payout_fx: { source: "market", perUsd: 1500 } })];
    perUsd = 2000;
    await payWithdrawalViaFlutterwave(W, "admin-1");
    expect(sent).toEqual([14_100_000]);
  });
  it("fixed rate: floor(net × minor-per-USD / 100) — the same rule as the database", async () => {
    source = "fixed";
    fixedMinor = 150_050; // ₦1,500.50 per USD
    const q = await payoutQuote(coinRow());
    expect(q).toMatchObject({ ok: true, kobo: Math.floor((9_400 * 150_050) / 100) });
  });
  it("fixed rate with no rate set: refused", async () => {
    source = "fixed";
    expect(await payoutQuote(coinRow())).toMatchObject({ ok: false });
    expect(sent).toEqual([]);
  });
  it("the quote cannot be recorded: nothing is sent", async () => {
    source = "market";
    db.rpc.record_coin_payout_quote = vi.fn(() => ({ data: { ok: false, reason: "not_quotable" }, error: null }));
    const out = await payWithdrawalViaFlutterwave(W, "admin-1");
    expect(out.ok).toBe(false);
    expect(sent).toEqual([]);
  });
  it("AI-credit / SUB payouts are worked out exactly as before (live rate, never recorded through the coin quote)", async () => {
    const q = await payoutQuote({ id: W, source: "sub", amount_usd_cents: 5_000 });
    expect(q).toMatchObject({ ok: true, kobo: 5_000 * 1500 });
    const c = await payoutQuote({ id: W, source: "credits", amount_usd_cents: 1_234 });
    expect(c).toMatchObject({ ok: true, kobo: 1_234 * 1500 });
    expect(db.rpc.record_coin_payout_quote).not.toHaveBeenCalled();
  });
});

/*
  Owner, 2026-10-27: "In withdraw, users in Nigeria, Ghana or any country supported by Paystack should use Paystack, but
  beyond should be Flutterwave." The destination bank's country decides (lib/rewards/payout-rail.ts).
*/
describe("which rail pays a Frenz Coin withdrawal", () => {
  beforeEach(() => {
    source = "market";
    coinRail = "by_country";
    vi.mocked(payWithdrawalViaPaystack).mockClear();
  });
  it("a Nigerian bank (every coin withdrawal today): Paystack — Flutterwave is never asked", async () => {
    await payWithdrawal(W, "admin-1");
    expect(payWithdrawalViaPaystack).toHaveBeenCalledWith(W, "admin-1");
    expect(sent).toEqual([]);
  });
  it("a bank in Ghana, South Africa or Kenya: Paystack", async () => {
    for (const country of ["GH", "za", "KE"]) {
      db.tables.withdrawal_requests = [coinRow({ payout_details: { bankCode: "1", accountNumber: "2", accountName: "ADA OBI", country } })];
      await payWithdrawal(W, "admin-1");
    }
    expect(payWithdrawalViaPaystack).toHaveBeenCalledTimes(3);
    expect(sent).toEqual([]);
  });
  it("a bank beyond Paystack's countries: Flutterwave", async () => {
    db.tables.withdrawal_requests = [coinRow({ payout_details: { bankCode: "058", accountNumber: "0123456789", accountName: "ADA OBI", country: "US" } })];
    expect((await payWithdrawal(W, "admin-1")).ok).toBe(true);
    expect(payWithdrawalViaPaystack).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
  });
  // 2026-10-28 (owner: "Paystack is blocking withdrawal, let's use Flutterwave … and I can switch"): the admin's rail
  it("the admin's Flutterwave rail pays even a Nigerian bank through Flutterwave — Paystack is not asked", async () => {
    coinRail = "flutterwave";
    expect((await payWithdrawal(W, "admin-1")).ok).toBe(true);
    expect(payWithdrawalViaPaystack).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
  });
  it("the admin's Paystack rail pays even a bank beyond Paystack's countries through Paystack", async () => {
    coinRail = "paystack";
    db.tables.withdrawal_requests = [coinRow({ payout_details: { bankCode: "058", accountNumber: "0123456789", accountName: "ADA OBI", country: "US" } })];
    await payWithdrawal(W, "admin-1");
    expect(payWithdrawalViaPaystack).toHaveBeenCalledWith(W, "admin-1");
    expect(sent).toEqual([]);
  });
  /*
    🔴 ONE CLEAN PATH (owner, 2026-10-29: "Withdrawal must be clean path through the provider selected by admin not two or
    any backup"). A definite Flutterwave refusal on "Flutterwave only" — or on the Flutterwave side of "by the bank's
    country" — is returned, never re-sent through Paystack. Only the explicit backup route reaches Paystack.
  */
  it("Flutterwave only: a definite refusal stops there — Paystack is never asked", async () => {
    coinRail = "flutterwave";
    source = "market";
    fwName = "SOMEONE ELSE";
    expect((await payWithdrawal(W, "admin-1")).ok).toBe(false);
    expect(payWithdrawalViaPaystack).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });
  it("by the bank's country: a Flutterwave-country refusal stops there too (one rail per withdrawal, no backup)", async () => {
    coinRail = "by_country";
    source = "market";
    fwName = "SOMEONE ELSE";
    db.tables.withdrawal_requests = [coinRow({ payout_details: { bankCode: "058", accountNumber: "0123456789", accountName: "ADA OBI", country: "US" } })];
    expect((await payWithdrawal(W, "admin-1")).ok).toBe(false);
    expect(payWithdrawalViaPaystack).not.toHaveBeenCalled();
  });
  it("Flutterwave with Paystack as backup: the same refusal is handed to Paystack", async () => {
    coinRail = "flutterwave_paystack_backup";
    source = "market";
    fwName = "SOMEONE ELSE";
    await payWithdrawal(W, "admin-1");
    expect(payWithdrawalViaPaystack).toHaveBeenCalledWith(W, "admin-1");
    expect(sent).toEqual([]);
  });
  it("an Exclusive (SUB) withdrawal keeps the admin's provider (Flutterwave here), even to a Nigerian bank", async () => {
    db.tables.withdrawal_requests = [coinRow({ source: "sub" })];
    await payWithdrawal(W, "admin-1");
    expect(payWithdrawalViaPaystack).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
  });
});
