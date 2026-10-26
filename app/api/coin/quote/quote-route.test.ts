import { beforeEach, describe, expect, it, vi } from "vitest";

import { COIN_DEFAULTS, coinTransferFee, type FrenzCoinConfig } from "@/lib/coin/config";

/**
 * Frenz Coin Part 5 — GET /api/coin/quote, the wallet's review step. Pinned: a session is required; the input is integer
 * cents only; switched off → 503 and no price; outside the published limits → 400; the transfer fee is the authoritative
 * brackets (10% + $1 under $100, 10% from $100 to $500 inclusive, 10% + $5 above) added ON TOP; the withdrawal fee is 6%
 * taken FROM the gross; "payout rate approved" follows the rate source; the answer is never publicly cacheable.
 */
let sessionUser: { id: string } | null;
let coin: FrenzCoinConfig;

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }) }));
vi.mock("@/lib/landing/settings", () => ({ getLandingSettings: async () => ({ frenzCoin: coin }) }));

const { GET } = await import("./route");
const q = (qs: string) => GET(new Request(`https://frenzsave.com/api/coin/quote?${qs}`));

beforeEach(() => {
  sessionUser = { id: "11111111-1111-4111-8111-111111111111" };
  coin = { ...COIN_DEFAULTS, enabled: true };
});

describe("GET /api/coin/quote", () => {
  it("needs a session (401) — never prices for a guest", async () => {
    sessionUser = null;
    expect((await q("kind=transfer&amountCents=5000")).status).toBe(401);
  });

  it("takes integer cents and a known kind only", async () => {
    for (const bad of ["kind=transfer&amountCents=50.5", "kind=transfer&amountCents=-1", "kind=transfer&amountCents=0", "kind=transfer&amountCents=1e3", "kind=transfer", "kind=card&amountCents=5000", "amountCents=5000"]) {
      expect((await q(bad)).status, bad).toBe(400);
    }
  });

  it("switched off → 503 'disabled', no price (both kinds)", async () => {
    coin = { ...COIN_DEFAULTS, enabled: false };
    const t = await q("kind=transfer&amountCents=5000");
    expect(t.status).toBe(503);
    expect(await t.json()).toMatchObject({ reason: "disabled" });
    expect((await q("kind=withdrawal&amountCents=5000")).status).toBe(503);
    coin = { ...COIN_DEFAULTS, enabled: true, transfers: { ...COIN_DEFAULTS.transfers, enabled: false } };
    expect((await q("kind=transfer&amountCents=5000")).status).toBe(503);
  });

  it.each([
    // [amount, fee, total] — the authoritative brackets, fee added on top
    [5_000, 600, 5_600], // $50: 10% + $1
    [9_999, 1_100, 11_099], // just under $100: 10% (999.9 → 1000, rounded up) + $1
    [10_000, 1_000, 11_000], // $100: 10%, no flat (inclusive)
    [50_000, 5_000, 55_000], // $500: 10%, no flat (inclusive)
    [50_001, 5_501, 55_502], // just over $500: 10% (5000.1 → 5001, rounded up like the database) + $5
    [60_000, 6_500, 66_500], // $600: 10% + $5
  ])("transfer of %i cents → fee %i, total %i", async (amount, fee, total) => {
    const r = await q(`kind=transfer&amountCents=${amount}`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toMatchObject({ kind: "transfer", amountCents: amount, feeCents: fee, totalCents: total });
    // the same integer formula as the server library (the database's TypeScript twin)
    expect(body.feeCents).toBe(coinTransferFee(amount, coin.transfers).feeCents);
    expect(Number.isInteger(body.feeCents) && Number.isInteger(body.totalCents)).toBe(true);
  });

  it("transfer outside the published limits → 400 amount_out_of_range", async () => {
    const lo = await q(`kind=transfer&amountCents=${COIN_DEFAULTS.transfers.minCents - 1}`);
    expect(lo.status).toBe(400);
    expect(await lo.json()).toMatchObject({ reason: "amount_out_of_range" });
    expect((await q(`kind=transfer&amountCents=${COIN_DEFAULTS.transfers.maxCents + 1}`)).status).toBe(400);
  });

  it("withdrawal: 6% taken FROM the gross; no approved rate is said plainly", async () => {
    const r = await q("kind=withdrawal&amountCents=10000");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ kind: "withdrawal", grossCents: 10_000, feeCents: 600, netCents: 9_400, payoutRateApproved: false });
  });

  it("withdrawal: an approved fixed or market rate → payoutRateApproved true; 'fixed' with no rate stays false", async () => {
    coin = { ...COIN_DEFAULTS, enabled: true, withdrawals: { ...COIN_DEFAULTS.withdrawals, payoutRateSource: "fixed", payoutMinorPerUsd: 150_000 } };
    expect((await (await q("kind=withdrawal&amountCents=10000")).json()).payoutRateApproved).toBe(true);
    coin = { ...COIN_DEFAULTS, enabled: true, withdrawals: { ...COIN_DEFAULTS.withdrawals, payoutRateSource: "market" } };
    expect((await (await q("kind=withdrawal&amountCents=10000")).json()).payoutRateApproved).toBe(true);
    coin = { ...COIN_DEFAULTS, enabled: true, withdrawals: { ...COIN_DEFAULTS.withdrawals, payoutRateSource: "fixed", payoutMinorPerUsd: null } };
    expect((await (await q("kind=withdrawal&amountCents=10000")).json()).payoutRateApproved).toBe(false);
  });

  it("withdrawal outside the limits → 400", async () => {
    expect((await q(`kind=withdrawal&amountCents=${COIN_DEFAULTS.withdrawals.minCents - 1}`)).status).toBe(400);
  });

  it("answers are private, never stored by a cache", async () => {
    const r = await q("kind=transfer&amountCents=5000");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
  });
});
