import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VerifiedCharge } from "@/lib/payments/charge";
import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Part 2.1 — a Flutterwave ad payment settles only on the EXACT amount and currency of its attempt row.
 * `ad_payment_settle` on its own allows "at least" (kept for Paystack), so an over- or underpayment must
 * be stopped before it and HELD as a mismatch for review — never settled, never "released" (which would
 * let a new checkout open after money moved). Real handler, in-memory database, scripted RPCs.
 */

let db: FakeDb;
vi.mock("server-only", () => ({}));
vi.mock("./ad-notify", () => ({ notifyAdvertiser: vi.fn(async () => {}) }));
vi.mock("./media-processing", () => ({ advanceCampaignProcessing: vi.fn(async () => {}) }));
vi.mock("./server", () => ({ activateCampaign: vi.fn(async () => ({ ok: true, already_active: true })), checkDestination: vi.fn() }));
vi.mock("@/lib/admin/funding-alerts", () => ({ flushFundingAlertsSoon: () => {} }));

const { handleFlutterwaveAdCharge } = await import("./payment-server");

const REF = "frenz_ad_fw_2b1c8f8e-2222-4222-8222-222222222222";
const charge = (over: Partial<VerifiedCharge> = {}): VerifiedCharge => ({ provider: "flutterwave", reference: REF, externalId: "61", status: "success", amountMinor: 2500, currency: "USD", channel: "card", paidAt: null, reason: null, ...over });
const calls = (name: string) => ((db.rpc[name] as ReturnType<typeof vi.fn> | undefined)?.mock.calls ?? []).map((c) => c[0]);

beforeEach(() => {
  db = fakeDb({ ai_topup_attempts: [{ reference: REF, user_id: "u1", provider: "flutterwave", purpose: "ad_campaign", status: "pending", item_id: "app1", amount_cents: 2500, currency: "USD", provider_currency: "USD", provider_amount: 2500, fx_minor_per_usd: null, external_id: null, checkout_url: "https://checkout.flutterwave.com/a", provider_request: null, created_at: new Date().toISOString(), verified_at: null, status_reason: null, quote_id: "q1" }] });
  db.rpc.ad_payment_settle = vi.fn(() => ({ data: { ok: true, campaign_ids: [] }, error: null }));
  db.rpc.ad_payment_release = vi.fn(() => ({ data: { ok: true }, error: null }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("Flutterwave ad payment — exact amount only", () => {
  it("the exact amount and currency settle through ad_payment_settle", async () => {
    expect(await handleFlutterwaveAdCharge(db.client() as never, charge())).toBe("ad settled");
    expect(calls("ad_payment_settle")).toEqual([expect.objectContaining({ p_reference: REF, p_provider: "flutterwave", p_paid_amount: 2500, p_paid_currency: "USD" })]);
  });
  it("one cent OVER is held as a mismatch for review — no settle, no release", async () => {
    expect(await handleFlutterwaveAdCharge(db.client() as never, charge({ amountMinor: 2501 }))).toBe("ad held");
    expect(calls("ad_payment_settle")).toEqual([]);
    expect(calls("ad_payment_release")).toEqual([{ p_reference: REF, p_status: "mismatch", p_reason: "flutterwave overpaid: paid 2501 USD" }]);
  });
  it("one cent UNDER (which the SQL's +1 tolerance would have accepted) is held too", async () => {
    expect(await handleFlutterwaveAdCharge(db.client() as never, charge({ amountMinor: 2499 }))).toBe("ad held");
    expect(calls("ad_payment_settle")).toEqual([]);
    expect(calls("ad_payment_release")[0]).toMatchObject({ p_status: "mismatch" });
  });
  it("another currency is held", async () => {
    expect(await handleFlutterwaveAdCharge(db.client() as never, charge({ currency: "NGN", amountMinor: 3_750_000 }))).toBe("ad held");
    expect(calls("ad_payment_settle")).toEqual([]);
  });
});
