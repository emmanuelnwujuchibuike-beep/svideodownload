import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VerifiedCharge } from "@/lib/payments/charge";
import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Part 2 — starting a wallet top-up with two rails. The real `beginCharacterReplaceTopup`, the real
 * router and capability gate, over an in-memory database. Scripted: the two providers' checkout
 * calls (no network) and Flutterwave's verify for a held attempt.
 *
 *   · the attempt row exists BEFORE either provider is called (it used to be written in after());
 *   · Flutterwave is used only when its capability is confirmed — otherwise Paystack, as before;
 *   · Paystack follows only a DEFINITE Flutterwave refusal — never an unknown outcome;
 *   · a held (unknown-outcome) Flutterwave attempt is resolved before any new checkout.
 */

let db: FakeDb;
let walletCurrency = "USD";
let fwCreate: (o: { reference: string }) => Promise<string>;
let fwVerify: (ref: string) => Promise<VerifiedCharge>;
const order: string[] = [];
const paystackInit = vi.fn(async (o: { reference: string }) => {
  order.push(`paystack:${o.reference}:${db.tables.ai_topup_attempts?.some((r) => r.reference === o.reference) ? "row-first" : "NO-ROW"}`);
  return `https://checkout.paystack.com/${o.reference}`;
});

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/landing/settings", async () => {
  const { normalizeAiWalletConfig } = await import("@/lib/ai/credits/wallet-config");
  return { getLandingSettings: async () => ({ frenzAiCurrency: walletCurrency, frenzAiPlans: { credits: { centsPerCredit: 10 }, wallet: normalizeAiWalletConfig(null) }, frenzAiCharacterReplace: { recharge: { checkoutCurrency: "NGN" } } }) };
});
vi.mock("@/lib/ai/character-replace/fx-rate-server", () => ({ resolveCheckoutRate: async () => ({ minorPerUsd: 150_000, marketPerUsd: 1500, markupPercent: 0, source: "stored", fetchedAt: null, provider: "test" }) }));
vi.mock("@/lib/paystack/paystack", async (orig) => ({ ...(await orig<typeof import("@/lib/paystack/paystack")>()), paystackEnabled: async () => true, initializeAiTopup: (o: { reference: string }) => paystackInit(o) }));
vi.mock("@/lib/flutterwave/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/flutterwave/client")>()),
  createFlutterwaveCheckout: (o: { reference: string }) => {
    order.push(`flutterwave:${o.reference}:${db.tables.ai_topup_attempts?.some((r) => r.reference === o.reference) ? "row-first" : "NO-ROW"}`);
    return fwCreate(o);
  },
  verifyFlutterwaveByReference: (ref: string) => fwVerify(ref),
}));
vi.mock("@/lib/ai/character-replace/recharge-server", () => ({ creditVerifiedCharacterReplaceRecharge: vi.fn(async () => ({ balanceAfterCents: 0, credits: 0, bonusCredits: 0 })), announceCharacterReplaceRecharge: async () => {} }));
vi.mock("@/lib/ai/wallet/paystack-settle", () => ({ settleUnpaidTopup: async () => {} }));

const { beginCharacterReplaceTopup } = await import("./topup-server");
const { FlutterwaveHttpError } = await import("@/lib/flutterwave/client");
const { PaystackHttpError } = await import("@/lib/paystack/paystack");

const USER = "11111111-1111-4111-8111-111111111111";
const start = () => beginCharacterReplaceTopup({ userId: USER, email: "a@b.co", packId: "pack_100", returnTo: "/ai/usage", market: "NG" });
const rows = (provider: string) => (db.tables.ai_topup_attempts ?? []).filter((r) => r.provider === provider);
const ENABLED = { FLUTTERWAVE_SECRET_KEY: "FLWSECK_TEST-k", FLUTTERWAVE_SECRET_HASH: "h", FLUTTERWAVE_VERIFIED_CURRENCIES: "USD", FLUTTERWAVE_ENABLED_PURPOSES: "wallet_topup", FLUTTERWAVE_AMOUNT_UNIT: "major" };
const setEnv = (on: boolean) => {
  for (const [k, v] of Object.entries(ENABLED)) {
    if (on) process.env[k] = v;
    else delete process.env[k];
  }
};

beforeEach(() => {
  db = fakeDb({ ai_topup_attempts: [] });
  db.unique.ai_topup_attempts = [["reference"]];
  walletCurrency = "USD";
  order.length = 0;
  paystackInit.mockClear();
  fwCreate = async (o) => `https://checkout.flutterwave.com/pay/${o.reference}`;
  fwVerify = async () => {
    throw new Error("not scripted");
  };
  setEnv(false);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("naira in Nigeria (2026-10-24: bank transfer / USSD only exist for NGN checkouts)", () => {
  const seen: { currency?: string; amountMinor?: number }[] = [];
  const capture = () => {
    seen.length = 0;
    fwCreate = async (o) => (seen.push(o as { currency?: string; amountMinor?: number }), `https://checkout.flutterwave.com/pay/${o.reference}`);
  };

  it("NGN confirmed + a member in Nigeria: the checkout is in NAIRA at the live rate; the row keeps the USD price for the credit", async () => {
    setEnv(true);
    process.env.FLUTTERWAVE_VERIFIED_CURRENCIES = "USD,NGN";
    capture();
    expect(await start()).toMatchObject({ ok: true, provider: "flutterwave", priceUsdCents: 1000 });
    // $10.00 at ₦1,500 per dollar (the mocked live rate) = ₦15,000.00 = 1,500,000 kobo
    expect(seen[0]).toMatchObject({ currency: "NGN", amountMinor: 1_500_000 });
    expect(rows("flutterwave")[0]).toMatchObject({ amount_cents: 1000, currency: "USD", provider_amount: 1_500_000, provider_currency: "NGN", fx_minor_per_usd: 150_000 });
  });

  it("a member outside Nigeria still pays USD", async () => {
    setEnv(true);
    process.env.FLUTTERWAVE_VERIFIED_CURRENCIES = "USD,NGN";
    capture();
    const r = await beginCharacterReplaceTopup({ userId: USER, email: "a@b.co", packId: "pack_100", returnTo: "/ai/usage", market: "other" });
    expect(r).toMatchObject({ ok: true, provider: "flutterwave" });
    expect(seen[0]).toMatchObject({ currency: "USD", amountMinor: 1000 });
    expect(rows("flutterwave")[0]).toMatchObject({ provider_amount: 1000, provider_currency: "USD", fx_minor_per_usd: null });
  });

  it("NGN not confirmed (switched off): Nigeria pays USD on Flutterwave as before — never a closed checkout", async () => {
    setEnv(true);
    process.env.FLUTTERWAVE_VERIFIED_CURRENCIES = "USD";
    capture();
    expect(await start()).toMatchObject({ ok: true, provider: "flutterwave" });
    expect(seen[0]).toMatchObject({ currency: "USD", amountMinor: 1000 });
  });
});

describe("wallet top-up, two rails (Part 2)", () => {
  it("capability unconfirmed (the default): Paystack only, exactly as before — and its attempt row is written FIRST", async () => {
    const r = await start();
    expect(r).toMatchObject({ ok: true, provider: "paystack", credits: 100, priceUsdCents: 1000 });
    expect(order).toHaveLength(1);
    expect(order[0]).toMatch(/^paystack:frenz_cr_topup_[0-9a-f-]{36}:row-first$/);
    expect(rows("flutterwave")).toEqual([]);
    expect(rows("paystack")[0]).toMatchObject({ status: "pending", purpose: "wallet_topup", amount_cents: 1000, currency: "USD", provider_currency: "NGN", provider_amount: 1_500_000, credits: 100, item_id: "pack_100" });
  });

  it("capability confirmed: Flutterwave in USD at the exact price, its attempt row written before the call; Paystack untouched", async () => {
    setEnv(true);
    const r = await start();
    expect(r).toMatchObject({ ok: true, provider: "flutterwave", priceUsdCents: 1000 });
    expect(order).toHaveLength(1);
    expect(order[0]).toMatch(/^flutterwave:frenz_cr_topup_fw_.+:row-first$/);
    expect(paystackInit).not.toHaveBeenCalled();
    expect(rows("flutterwave")[0]).toMatchObject({ status: "pending", amount_cents: 1000, currency: "USD", provider_amount: 1000, provider_currency: "USD", fx_minor_per_usd: null, checkout_url: expect.stringContaining("checkout.flutterwave.com") });
  });

  it("switched off for USD (env 'none'): Flutterwave is skipped (no attempt row), Paystack takes it", async () => {
    setEnv(true);
    process.env.FLUTTERWAVE_VERIFIED_CURRENCIES = "none";
    expect(await start()).toMatchObject({ ok: true, provider: "paystack" });
    expect(rows("flutterwave")).toEqual([]);
  });

  it("a non-USD wallet never uses Flutterwave (its price would not be the charge)", async () => {
    setEnv(true);
    walletCurrency = "NGN";
    expect(await start()).toMatchObject({ ok: true, provider: "paystack" });
    expect(rows("flutterwave")).toEqual([]);
  });

  it("a DEFINITE Flutterwave refusal: its attempt is closed as failed, then Paystack opens the checkout", async () => {
    setEnv(true);
    fwCreate = async () => {
      throw new FlutterwaveHttpError("Invalid currency", 400);
    };
    expect(await start()).toMatchObject({ ok: true, provider: "paystack" });
    expect(rows("flutterwave")[0]).toMatchObject({ status: "failed" });
    expect(order.map((o) => o.split(":")[0])).toEqual(["flutterwave", "paystack"]);
  });

  it("Part 4.1: both rails refusing DEFINITELY answers 503 (never 502), and both attempts are closed", async () => {
    setEnv(true);
    fwCreate = async () => {
      throw new FlutterwaveHttpError("Invalid currency", 400);
    };
    paystackInit.mockImplementationOnce(async () => {
      throw new PaystackHttpError("Invalid key", 401);
    });
    expect(await start()).toEqual({ ok: false, status: 503, error: "We couldn't start that payment. Try again." });
    expect(rows("flutterwave")[0]).toMatchObject({ status: "failed" });
    expect(rows("paystack")[0]).toMatchObject({ status: "failed" });
  });

  it("🔴 an UNKNOWN Flutterwave outcome (timeout / 5xx): held for verification and NO Paystack checkout", async () => {
    setEnv(true);
    fwCreate = async () => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    };
    const r = await start();
    // Part 4.1: 503, never 502 (Cloudflare replaces an origin 502 with its own page); the body says it is unconfirmed, not failed
    expect(r).toEqual({ ok: false, status: 503, error: expect.stringMatching(/couldn't confirm the payment page opened/i) });
    expect(paystackInit).not.toHaveBeenCalled();
    expect(rows("flutterwave")[0]).toMatchObject({ status: "verification_required" });

    fwCreate = async () => {
      throw new FlutterwaveHttpError("upstream", 503);
    };
    db = fakeDb({ ai_topup_attempts: [] });
    expect(await start()).toMatchObject({ ok: false });
    expect(paystackInit).not.toHaveBeenCalled();
  });

  it("a held attempt that Flutterwave still shows pending blocks a new checkout on EITHER rail", async () => {
    setEnv(true);
    db.tables.ai_topup_attempts!.push({ reference: "frenz_cr_topup_fw_2b1c8f8e-1111-4111-8111-111111111111", user_id: USER, provider: "flutterwave", purpose: "wallet_topup", status: "verification_required", amount_cents: 1000, currency: "USD", provider_amount: 1000, provider_currency: "USD", item_id: "pack_100", checkout_url: null, created_at: new Date().toISOString() });
    fwVerify = async (reference) => ({ provider: "flutterwave", reference, externalId: "9", status: "pending", amountMinor: 1000, currency: "USD", channel: null, paidAt: null, reason: null });
    const r = await start();
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(order).toEqual([]);
    expect(paystackInit).not.toHaveBeenCalled();
  });

  it("a held attempt Flutterwave has never heard of (no link was ever handed out) is released, then the new checkout opens", async () => {
    setEnv(true);
    const held = "frenz_cr_topup_fw_2b1c8f8e-1111-4111-8111-111111111111";
    db.tables.ai_topup_attempts!.push({ reference: held, user_id: USER, provider: "flutterwave", purpose: "wallet_topup", status: "verification_required", amount_cents: 1000, currency: "USD", provider_amount: 1000, provider_currency: "USD", item_id: "pack_100", checkout_url: null, created_at: new Date().toISOString() });
    fwVerify = async (reference) => ({ provider: "flutterwave", reference, externalId: null, status: "not_found", amountMinor: null, currency: null, channel: null, paidAt: null, reason: null });
    expect(await start()).toMatchObject({ ok: true, provider: "flutterwave" });
    expect(db.tables.ai_topup_attempts!.find((r) => r.reference === held)).toMatchObject({ status: "failed" });
  });

  it("Part 3: a Paystack timeout is held (verification_required), and the next tap opens NOTHING while it may be paid", async () => {
    paystackInit.mockImplementationOnce(async () => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    });
    expect(await start()).toMatchObject({ ok: false });
    expect(rows("paystack")[0]).toMatchObject({ status: "verification_required" });
    // Paystack can't be asked here (paystack verify is not scripted → unreachable): held, no second checkout on either rail
    setEnv(true);
    const again = await start();
    expect(again).toMatchObject({ ok: false, status: 409 });
    expect(order.filter((o) => o.startsWith("flutterwave"))).toEqual([]);
    expect(paystackInit).toHaveBeenCalledTimes(1);
  });

  it("an attempt row that can't be written stops the checkout before any provider is called", async () => {
    db.failOn.ai_topup_attempts = "connection reset";
    const r = await start();
    expect(r).toMatchObject({ ok: false, status: 503 });
    expect(order).toEqual([]);
  });

  it("nothing from the browser decides the price: a forged credits/price is refused by the offer", async () => {
    const r = await beginCharacterReplaceTopup({ userId: USER, email: "a@b.co", credits: 7, returnTo: "/ai/usage" });
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(order).toEqual([]);
  });
});
