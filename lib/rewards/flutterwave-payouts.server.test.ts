import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Flutterwave payouts (2026-10-24): the reference is recorded BEFORE the transfer is sent; Paystack backs it up ONLY
 * when Flutterwave definitely sent nothing (not configured, a 4xx, or a different account holder); an unknown outcome
 * holds the money and sends nothing else.
 */
let db: FakeDb;
const W = "11111111-1111-4111-8111-111111111111";
const FREF = `frenz_fwd_${W.replace(/-/g, "")}`;
let provider: "flutterwave" | "paystack" = "flutterwave";
let secretKey = "FLWSECK_TEST-x";
let resolveName: () => Promise<string> = async () => "AMAKA OBI";
let transfer: () => Promise<{ status: string; id: string | null }> = async () => ({ status: "NEW", id: "9" });
const seenAtSend: (string | null)[] = [];
const paystack = vi.fn(async () => ({ ok: true as const, status: "pending" }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/ai/character-replace/fx-rate-server", () => ({ marketRate: async () => ({ rate: { perUsd: 1500 }, source: "stored" }) }));
vi.mock("@/lib/landing/settings", () => ({ getLandingSettings: async () => ({ frenzRewards: { sub: { payoutProvider: provider } } }) }));
vi.mock("@/lib/flutterwave/config", () => ({ getFlutterwaveConfig: async () => ({ secretKey }) }));
vi.mock("@/lib/flutterwave/client", async (orig) => {
  const real = await orig<typeof import("@/lib/flutterwave/client")>();
  return {
    ...real,
    resolveFlutterwaveAccount: () => resolveName(),
    createFlutterwaveTransfer: async () => {
      seenAtSend.push((db.tables.withdrawal_requests![0]!.payout_reference as string | null) ?? null);
      return transfer();
    },
  };
});
vi.mock("./paystack-payouts", () => ({ PAYSTACK_METHOD: "paystack", payWithdrawalViaPaystack: () => paystack() }));
vi.mock("./withdrawals", () => ({
  resolveWithdrawal: async (i: { id: string; status: string; payoutReference?: string | null }) => {
    const row = db.tables.withdrawal_requests!.find((r) => r.id === i.id)!;
    row.status = i.status;
    if (i.payoutReference) row.payout_reference = i.payoutReference;
    return { ok: true };
  },
}));

const { payWithdrawal, sameAccountHolder } = await import("./flutterwave-payouts");
const { FlutterwaveHttpError } = await import("@/lib/flutterwave/client");
const row = () => db.tables.withdrawal_requests![0]!;

beforeEach(() => {
  db = fakeDb({ withdrawal_requests: [{ id: W, user_id: "u", status: "pending", payout_method: "paystack", payout_reference: null, amount_usd_cents: 5000, payout_details: { bankCode: "058", accountNumber: "0123456789", accountName: "OBI AMAKA" }, updated_at: "2026-10-24T00:00:00Z" }] });
  provider = "flutterwave";
  secretKey = "FLWSECK_TEST-x";
  resolveName = async () => "AMAKA OBI";
  transfer = async () => ({ status: "NEW", id: "9" });
  seenAtSend.length = 0;
  paystack.mockClear();
});

describe("Flutterwave payouts", () => {
  it("sends through Flutterwave with its reference RECORDED before the transfer call; Paystack untouched", async () => {
    expect(await payWithdrawal(W, null)).toMatchObject({ ok: true, provider: "flutterwave" });
    expect(seenAtSend).toEqual([FREF]);
    expect(row()).toMatchObject({ status: "processing", payout_reference: FREF });
    expect(paystack).not.toHaveBeenCalled();
  });

  it("a different account holder under the same bank code: nothing sent by Flutterwave, Paystack pays it", async () => {
    resolveName = async () => "SOMEONE ELSE";
    expect(await payWithdrawal(W, null)).toMatchObject({ ok: true, provider: "paystack" });
    expect(seenAtSend).toEqual([]);
    expect(paystack).toHaveBeenCalledTimes(1);
  });

  it("a 4xx on the transfer: definite — the reference is taken back off, then Paystack", async () => {
    transfer = async () => {
      throw new FlutterwaveHttpError("Insufficient balance", 400);
    };
    expect(await payWithdrawal(W, null)).toMatchObject({ provider: "paystack" });
    expect(row().payout_reference).toBeNull();
    expect(paystack).toHaveBeenCalledTimes(1);
  });

  it("a timeout / 5xx: UNKNOWN — held as processing with the Flutterwave reference, never a second rail", async () => {
    transfer = async () => {
      throw new FlutterwaveHttpError("upstream", 502);
    };
    expect(await payWithdrawal(W, null)).toMatchObject({ ok: true, status: "unknown", provider: "flutterwave" });
    expect(row()).toMatchObject({ status: "processing", payout_reference: FREF });
    expect(paystack).not.toHaveBeenCalled();
  });

  it("Flutterwave not configured → Paystack; the admin choosing Paystack → Paystack only", async () => {
    secretKey = "";
    expect(await payWithdrawal(W, null)).toMatchObject({ provider: "paystack" });
    secretKey = "FLWSECK_TEST-x";
    provider = "paystack";
    paystack.mockClear();
    expect(await payWithdrawal(W, null)).toMatchObject({ provider: "paystack" });
    expect(seenAtSend).toEqual([]);
  });

  it("account holder names match by words, not order or case", () => {
    expect(sameAccountHolder("AMAKA OBI", "Obi Amaka")).toBe(true);
    expect(sameAccountHolder("AMAKA CHIOMA OBI", "Obi Amaka")).toBe(true);
    expect(sameAccountHolder("JOHN DOE", "Obi Amaka")).toBe(false);
  });
});
