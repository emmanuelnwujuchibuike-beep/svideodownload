import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

import { normalizePaidVerification, paidVerificationExpiry } from "./paid-verification-config";

/**
 * Paying for the blue tick (0268) — the money rules, each with a case that must NOT grant.
 */

let db: FakeDb;
let charge: Record<string, unknown> = {};
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/paystack/paystack", () => ({
  VERIFICATION_PURPOSE: "frenz_verification",
  verifyTransaction: async () => charge,
  initializeVerificationCheckout: async () => "https://checkout.paystack.test/x",
  paystackFailureIsDefinite: () => true,
}));
vi.mock("@/lib/landing/settings", () => ({ getLandingSettings: async () => ({ frenzAiCharacterReplace: { recharge: { checkoutCurrency: "NGN" } } }) }));
vi.mock("@/lib/ai/character-replace/fx-rate-server", () => ({ resolveCheckoutRate: async () => ({ minorPerUsd: 160_000 }) }));

const pv = await import("./paid-verification");

const USER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const REF = "frenz_vf_0123456789abcdef";
const old = new Date(Date.now() - 60 * 60_000).toISOString();

function seed(over: Record<string, unknown> = {}) {
  db = fakeDb({
    settings: [{ key: "paid_verification", value: { enabled: true, priceCents: 500, periodDays: 30 } }],
    profiles: [{ id: USER, is_verified: false, is_suspended: false }],
    verification_requests: [],
    verification_events: [],
    verification_purchases: [{ id: "p1", user_id: USER, reference: REF, price_cents: 500, charged_currency: "NGN", charged_minor: 800_000, period_days: 30, status: "initiated", created_at: old, ...over }],
  });
}

beforeEach(() => {
  seed();
  charge = { status: "success", amount: 800_000, currency: "NGN", id: 42, metadata: { purpose: "frenz_verification", user_id: USER } };
});

const verified = () => (db.tables.profiles![0] as { is_verified: boolean }).is_verified;
const approvals = () => db.tables.verification_requests!.filter((r) => r.status === "approved").length;

describe("the admin's settings", () => {
  it("are off by default and switch off when the price is outside the bounds", () => {
    expect(normalizePaidVerification(null)).toEqual({ enabled: false, priceCents: 0, periodDays: 30 });
    expect(normalizePaidVerification({ enabled: true, priceCents: 500, periodDays: 0 })).toEqual({ enabled: true, priceCents: 500, periodDays: 0 });
    expect(normalizePaidVerification({ enabled: true, priceCents: 10, periodDays: 30 }).enabled).toBe(false);
    expect(normalizePaidVerification({ enabled: true, priceCents: 500, periodDays: -4 }).periodDays).toBe(30);
  });

  it("a renewal before the end adds on; a lapsed one starts now; 0 days is for good", () => {
    const now = Date.parse("2026-10-23T00:00:00Z");
    expect(paidVerificationExpiry(30, "2026-11-01T00:00:00Z", now)).toBe("2026-12-01T00:00:00.000Z");
    expect(paidVerificationExpiry(30, "2026-10-01T00:00:00Z", now)).toBe("2026-11-22T00:00:00.000Z");
    expect(paidVerificationExpiry(0, null, now)).toBeNull();
  });
});

describe("🔴 the tick comes only from Paystack's verified charge", () => {
  it("a paid charge grants the tick, with an audited approved request", async () => {
    expect(await pv.confirmVerificationPayment(REF)).toBe("paid");
    expect(verified()).toBe(true);
    expect(approvals()).toBe(1);
    expect(db.tables.verification_events!.some((e) => e.action === "paid")).toBe(true);
    expect(db.tables.verification_purchases![0]!.expires_at).toBeTruthy();
  });

  it("teeth: the webhook and the return page both confirming grant ONCE", async () => {
    await pv.confirmVerificationPayment(REF);
    await pv.confirmVerificationPayment(REF);
    expect(approvals()).toBe(1);
  });

  it("teeth: less than asked, or another currency, grants nothing", async () => {
    charge.amount = 799_999;
    expect(await pv.confirmVerificationPayment(REF)).toBe("failed");
    expect(verified()).toBe(false);
    seed();
    charge = { ...charge, amount: 800_000, currency: "USD" };
    expect(await pv.confirmVerificationPayment(REF)).toBe("failed");
    expect(verified()).toBe(false);
  });

  it("teeth: a charge of another purpose, another member's reference, or a made-up one grants nothing", async () => {
    charge.metadata = { purpose: "frenz_sub", user_id: USER };
    expect(await pv.confirmVerificationPayment(REF)).toBe("unknown");
    seed();
    charge.metadata = { purpose: "frenz_verification", user_id: USER };
    expect(await pv.confirmVerificationPayment(REF, { userId: OTHER })).toBe("unknown");
    expect(await pv.confirmVerificationPayment("frenz_vf_nope_nope_nope")).toBe("unknown");
    expect(verified()).toBe(false);
  });

  it("an unfinished checkout stays open (a bank transfer may still complete)", async () => {
    seed({ created_at: new Date().toISOString() });
    charge.status = "abandoned";
    expect(await pv.confirmVerificationPayment(REF)).toBe("pending");
    expect(verified()).toBe(false);
  });

  it("a refund takes a paid tick back", async () => {
    await pv.confirmVerificationPayment(REF);
    expect(verified()).toBe(true);
    expect(await pv.reversePaidVerification(REF)).toBe("reversed");
    expect(verified()).toBe(false);
  });
});

describe("the daily sweep", () => {
  it("takes back a paid tick whose period ended — and never a reviewed one", async () => {
    await pv.confirmVerificationPayment(REF);
    db.tables.verification_purchases![0]!.expires_at = new Date(Date.now() - 1000).toISOString();
    expect((await pv.expirePaidVerifications()).expired).toBe(1);
    expect(verified()).toBe(false);

    // a reviewed tick: the latest approval is not the paid one
    seed();
    await pv.confirmVerificationPayment(REF);
    db.tables.verification_requests!.push({ id: "r2", user_id: USER, status: "approved", decision_reason: "Looks good", created_at: new Date(Date.now() + 1000).toISOString() });
    db.tables.verification_purchases![0]!.expires_at = new Date(Date.now() - 1000).toISOString();
    expect((await pv.expirePaidVerifications()).expired).toBe(0);
    expect(verified()).toBe(true);
  });
});
