import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VerifiedCharge } from "@/lib/payments/charge";
import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Part 2 — the Flutterwave webhook, driven for real: the route, the verif-hash check, the
 * provider-event log (claim/mark), and the real wallet settle (lib/ai/wallet/flutterwave-settle.ts)
 * over an in-memory database. Only two things are scripted: Flutterwave's verify API (no network)
 * and the SQL credit, which is modelled exactly as `credit_product_balance` behaves — once per
 * (user, kind, reference) — so a replay or a race can be counted.
 */

let db: FakeDb;
let apiAnswer: (id: string) => VerifiedCharge | Promise<VerifiedCharge>;
const verifyCalls: string[] = [];
const credited = new Map<string, number>();
const creditCalls: { reference: string; amountCents: number }[] = [];
const unpaid: { reference: string; outcome: string }[] = [];

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/flutterwave/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/flutterwave/client")>()),
  verifyFlutterwaveById: async (id: string) => (verifyCalls.push(id), apiAnswer(id)),
  verifyFlutterwaveByReference: async () => {
    throw new Error("the webhook verifies by id");
  },
  // Part 3.3: what Flutterwave lists for a customer + plan (the cancellation check)
  findFlutterwaveSubscriptions: async () => fwSubs,
}));
let fwSubs: { id: string; status: string; plan: string; email: string; amount: number | null }[] = [];
vi.mock("@/lib/ai/character-replace/recharge-server", () => ({
  // credit_product_balance: idempotent on the reference — a second call for it credits nothing
  creditVerifiedCharacterReplaceRecharge: async (o: { reference: string; amountCents: number }) => {
    creditCalls.push({ reference: o.reference, amountCents: o.amountCents });
    if (!credited.has(o.reference)) credited.set(o.reference, o.amountCents / 10);
    return { balanceAfterCents: credited.get(o.reference)!, credits: o.amountCents / 10, bonusCredits: 0 };
  },
  announceCharacterReplaceRecharge: async () => {},
}));
vi.mock("@/lib/ai/wallet/paystack-settle", () => ({ settleUnpaidTopup: async (o: { reference: string; outcome: string }) => void unpaid.push(o) }));
vi.mock("@/lib/sub/server", () => ({ confirmSubPayment: vi.fn(async () => ({ ok: true, status: "paid" })) }));
vi.mock("@/lib/social/paid-verification", () => ({ confirmVerificationPayment: vi.fn(async () => "paid") }));
vi.mock("@/lib/ads-platform/payment-server", () => ({ handleFlutterwaveAdCharge: vi.fn(async () => "ad settled") }));

process.env.FLUTTERWAVE_SECRET_HASH = "the-secret-hash";
process.env.FLUTTERWAVE_SECRET_KEY = "FLWSECK_TEST-k";

const { POST } = await import("./route");

const USER = "11111111-1111-4111-8111-111111111111";
const REF = "frenz_cr_topup_fw_2b1c8f8e-1111-4111-8111-111111111111";
const TX = "4242";
const success = (over: Partial<VerifiedCharge> = {}): VerifiedCharge => ({ provider: "flutterwave", reference: REF, externalId: TX, status: "success", amountMinor: 1000, currency: "USD", channel: "card", paidAt: null, reason: "Approved", ...over });

const deliver = (opts: { hash?: string | null; ref?: string; id?: string; bodyStatus?: string; event?: string } = {}) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.hash !== null) headers["verif-hash"] = opts.hash ?? "the-secret-hash";
  return POST(new Request("https://frenzsave.com/api/flutterwave/webhook", { method: "POST", headers, body: JSON.stringify({ event: opts.event ?? "charge.completed", data: { id: Number(opts.id ?? TX), tx_ref: opts.ref ?? REF, status: opts.bodyStatus ?? "successful", amount: 10, currency: "USD" } }) }));
};
const attempt = () => db.tables.ai_topup_attempts!.find((r) => r.reference === REF)!;
const logged = () => db.tables.payment_provider_events?.find((e) => e.event_id === `charge.completed:${TX}`);

beforeEach(() => {
  db = fakeDb({
    payment_provider_events: [],
    ai_topup_attempts: [{ reference: REF, user_id: USER, provider: "flutterwave", purpose: "wallet_topup", status: "pending", amount_cents: 1000, currency: "USD", provider_amount: 1000, provider_currency: "USD", item_id: "pack_100", checkout_url: "https://checkout.flutterwave.com/x", created_at: new Date(Date.now() - 60_000).toISOString() }],
  });
  db.unique.payment_provider_events = [["provider", "event_id"]];
  verifyCalls.length = 0;
  creditCalls.length = 0;
  unpaid.length = 0;
  credited.clear();
  apiAnswer = () => success();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("Flutterwave webhook — the hash proves the sender, the API proves the payment", () => {
  it("a missing or wrong verif-hash is refused before anything is read or verified", async () => {
    expect((await deliver({ hash: null })).status).toBe(401);
    expect((await deliver({ hash: "the-secret-has" })).status).toBe(401);
    expect((await deliver({ hash: "nope" })).status).toBe(401);
    expect(verifyCalls).toEqual([]);
    expect(creditCalls).toEqual([]);
    expect(db.tables.payment_provider_events).toEqual([]);
  });

  it("a verified success credits the price WE stored, once, and the delivery is marked processed", async () => {
    const res = await deliver();
    expect(res.status).toBe(200);
    expect(verifyCalls).toEqual([TX]);
    expect(creditCalls).toEqual([{ reference: REF, amountCents: 1000 }]);
    expect(logged()?.processed_at).toBeTruthy();
    expect(attempt().external_id).toBe(TX);
  });

  it("🔴 the body says 'successful' but the API says pending → nothing is granted, and a retry is asked for", async () => {
    apiAnswer = () => success({ status: "pending" });
    const res = await deliver({ bodyStatus: "successful" });
    expect(res.status).toBe(500);
    expect(creditCalls).toEqual([]);
    expect(logged()?.processed_at ?? null).toBeNull();
  });

  it("the retry after that pending answer settles, once", async () => {
    apiAnswer = () => success({ status: "pending" });
    expect((await deliver()).status).toBe(500);
    apiAnswer = () => success();
    expect((await deliver()).status).toBe(200);
    expect(credited.get(REF)).toBe(100);
    expect(logged()?.processed_at).toBeTruthy();
  });

  it("a duplicate delivery of a processed event is acknowledged and does nothing — no verify, no credit", async () => {
    await deliver();
    const res = await deliver();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ duplicate: true });
    expect(verifyCalls).toEqual([TX]);
    expect(creditCalls).toHaveLength(1);
  });

  it("concurrent deliveries (and a return-page check) credit once: every path settles under the same reference", async () => {
    const results = await Promise.all([deliver(), deliver(), deliver()]);
    for (const r of results) expect([200, 500]).toContain(r.status);
    expect(new Set(creditCalls.map((c) => c.reference))).toEqual(new Set([REF]));
    expect(credited.size).toBe(1);
    expect(credited.get(REF)).toBe(100);
  });

  it("a wrong amount credits nothing and the attempt is held as a mismatch", async () => {
    apiAnswer = () => success({ amountMinor: 999 });
    expect((await deliver()).status).toBe(200);
    expect(creditCalls).toEqual([]);
    expect(attempt().status).toBe("mismatch");
  });

  it("Part 2.1: an OVERpayment credits nothing either — held as a mismatch for review, no extra value", async () => {
    apiAnswer = () => success({ amountMinor: 1001 });
    expect((await deliver()).status).toBe(200);
    expect(creditCalls).toEqual([]);
    expect(attempt()).toMatchObject({ status: "mismatch", status_reason: "flutterwave overpaid" });
    // a replay of the same event, or of another for it, never turns the review into a credit
    expect((await deliver({ id: "4243" })).status).toBe(200);
    expect(creditCalls).toEqual([]);
  });

  it("a wrong currency credits nothing (a charge in another currency is never treated as USD)", async () => {
    apiAnswer = () => success({ currency: "NGN", amountMinor: 1_500_000 });
    expect((await deliver()).status).toBe(200);
    expect(creditCalls).toEqual([]);
    expect(attempt().status).toBe("mismatch");
  });

  it("the API's transaction is for another reference → ignored, nothing credited", async () => {
    apiAnswer = () => success({ reference: "frenz_cr_topup_fw_99999999-1111-4111-8111-111111111111" });
    const res = await deliver();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ignored: "reference mismatch" });
    expect(creditCalls).toEqual([]);
  });

  it("a failed transaction is recorded (failed, announced once by the shared path) and grants nothing", async () => {
    apiAnswer = () => success({ status: "failed", reason: "Insufficient funds" });
    expect((await deliver({ bodyStatus: "failed" })).status).toBe(200);
    expect(creditCalls).toEqual([]);
    expect(unpaid).toEqual([expect.objectContaining({ reference: REF, outcome: "failed" })]);
  });

  it("Flutterwave unreachable → a retry is asked for; the event is not marked processed", async () => {
    apiAnswer = () => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    };
    expect((await deliver()).status).toBe(500);
    expect(logged()?.processed_at ?? null).toBeNull();
    expect(creditCalls).toEqual([]);
  });

  it("a reference we never minted is verified by id (it may be a plan renewal) and credits nothing", async () => {
    const res = await deliver({ ref: "frenz_cr_topup_2b1c8f8e-1111-4111-8111-111111111111" });
    expect(res.status).toBe(200);
    expect(verifyCalls).toEqual([TX]);
    expect(creditCalls).toEqual([]);
  });

  it("an attempt that is not Flutterwave's (provider paystack) is never settled through this route", async () => {
    attempt().provider = "paystack";
    expect((await deliver()).status).toBe(200);
    expect(creditCalls).toEqual([]);
  });

  it("other event types are acknowledged and ignored; a transfer that isn't a Frenz payout is ignored unverified", async () => {
    const res = await deliver({ event: "refund.completed" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ignored: "refund.completed" });
    const t = await deliver({ event: "transfer.completed" });
    expect(await t.json()).toMatchObject({ ignored: "not a Frenz payout" });
    expect(verifyCalls).toEqual([]);
  });

  it("SUB, verification and ad references are routed to their own settle — with the API-verified charge", async () => {
    const { confirmSubPayment } = await import("@/lib/sub/server");
    const { confirmVerificationPayment } = await import("@/lib/social/paid-verification");
    const { handleFlutterwaveAdCharge } = await import("@/lib/ads-platform/payment-server");
    const sub = `frenz_sub_fw_${"ab".repeat(16)}`;
    apiAnswer = () => success({ reference: sub });
    expect((await deliver({ ref: sub, id: "51" })).status).toBe(200);
    expect(confirmSubPayment).toHaveBeenCalledWith(sub, { flutterwaveCharge: expect.objectContaining({ reference: sub, status: "success" }) });
    const vf = `frenz_vf_fw_${"cd".repeat(16)}`;
    apiAnswer = () => success({ reference: vf });
    expect((await deliver({ ref: vf, id: "52" })).status).toBe(200);
    expect(confirmVerificationPayment).toHaveBeenCalledWith(vf, { flutterwaveCharge: expect.objectContaining({ reference: vf }) });
    const ad = "frenz_ad_fw_2b1c8f8e-2222-4222-8222-222222222222";
    apiAnswer = () => success({ reference: ad });
    expect((await deliver({ ref: ad, id: "53" })).status).toBe(200);
    expect(handleFlutterwaveAdCharge).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reference: ad }));
  });
});

describe("Part 3.3 — plan transactions are told apart by transaction id; the log never fails open", () => {
  const PLAN_REF = "frenz_ai_plan_fw_2b1c8f8e-2222-4222-8222-222222222222";
  const FIRST_TX = "4242";
  const seedPlan = () => {
    db.tables.ai_topup_attempts = [{ reference: PLAN_REF, user_id: USER, provider: "flutterwave", purpose: "ai_subscription", status: "success", item_id: "ai_pro", provider_amount: 1000, provider_currency: "USD", charge_id: FIRST_TX, created_at: new Date(Date.now() - 40 * 86_400_000).toISOString() }];
    db.tables.ai_subscriptions = [{ user_id: USER, plan: "ai_pro", status: "active", provider: "flutterwave", plan_code: "123", subscription_ref: "55", customer_ref: "a@b.co", contract_amount_minor: 1000, contract_currency: "USD", contract_interval: "monthly", current_period_end: new Date(Date.now() + 86_400_000).toISOString(), cancel_at_period_end: false }];
    db.tables.subscriptions = [];
    db.tables.plan_renewals = [];
    db.tables.plan_billing_reviews = [];
    db.unique.plan_billing_reviews = [["dedupe_key"]];
    db.defaults.plan_billing_reviews = { status: "open" };
  };
  const planCharge = (over: Partial<VerifiedCharge> = {}) => success({ reference: PLAN_REF, customerEmail: "a@b.co", ...over });
  const eventFor = (id: string) => db.tables.payment_provider_events?.find((e) => e.event_id === `charge.completed:${id}`);

  it("H5 — a LATER transaction that reuses the original tx_ref is not 'already settled': it goes to the renewal path (a review), nothing extended", async () => {
    seedPlan();
    const end = db.tables.ai_subscriptions![0]!.current_period_end;
    apiAnswer = (id) => planCharge({ externalId: id });
    const res = await deliver({ ref: PLAN_REF, id: "5555" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcome: "renewal:review" });
    // Part 3.3.2: no subscription is named on the review — the email match is never written as a target
    expect(db.tables.plan_billing_reviews).toEqual([expect.objectContaining({ kind: "renewal", transaction_id: "5555", subscription_ref: null, user_id: null })]);
    expect(db.tables.ai_subscriptions![0]!.current_period_end).toBe(end);
    expect(eventFor("5555")?.processed_at).toBeTruthy();
  });

  it("…while the ORIGINAL transaction redelivered is 'already settled' — no review, no second activation", async () => {
    seedPlan();
    apiAnswer = (id) => planCharge({ externalId: id });
    expect((await deliver({ ref: PLAN_REF, id: FIRST_TX })).status).toBe(200);
    expect(db.tables.plan_billing_reviews).toEqual([]);
    expect(eventFor(FIRST_TX)?.outcome).toBe("ai_subscription:already_settled");
  });

  it("M4 — the event log can't be written (not a duplicate): a retry is asked for, nothing is verified or granted", async () => {
    seedPlan();
    db.failOn.payment_provider_events = "connection reset";
    const res = await deliver({ ref: PLAN_REF, id: "5556" });
    expect(res.status).toBe(500);
    expect(verifyCalls).toEqual([]);
    expect(db.tables.plan_billing_reviews).toEqual([]);
  });

  it("§10 — a renewal still PENDING is acknowledged but NOT marked processed; its later 'successful' delivery is handled", async () => {
    seedPlan();
    apiAnswer = (id) => planCharge({ reference: "Links-616626414629", externalId: id, status: "pending" });
    expect((await deliver({ ref: "Links-616626414629", id: "6001" })).status).toBe(200);
    expect(eventFor("6001")?.processed_at ?? null).toBeNull();
    apiAnswer = (id) => planCharge({ reference: "Links-616626414629", externalId: id });
    expect(await (await deliver({ ref: "Links-616626414629", id: "6001" })).json()).toMatchObject({ outcome: "renewal:review" });
    expect(eventFor("6001")?.processed_at).toBeTruthy();
  });

  it("H4 — the documented cancellation payload (plan as an object) through the route: confirmed → cancel at period end, recorded", async () => {
    seedPlan();
    fwSubs = [{ id: "55", status: "cancelled", plan: "123", email: "a@b.co", amount: 10 }];
    const body = { event: "subscription.cancelled", data: { status: "deactivated", amount: 10, currency: "USD", customer: { email: "a@b.co", full_name: "Anonymous customer" }, plan: { id: 123, name: "AI Pro", amount: 10, currency: "USD", interval: "monthly", status: "cancel" } } };
    const res = await POST(new Request("https://frenzsave.com/api/flutterwave/webhook", { method: "POST", headers: { "content-type": "application/json", "verif-hash": "the-secret-hash" }, body: JSON.stringify(body) }));
    expect(await res.json()).toMatchObject({ outcome: "cancel:confirmed" });
    expect(db.tables.ai_subscriptions![0]).toMatchObject({ status: "active", cancel_at_period_end: true });
    const logged = db.tables.payment_provider_events!.find((e) => String(e.event_id).startsWith("subscription.cancelled:123:"));
    expect(logged?.outcome).toBe("cancel:confirmed");
    // no raw email in the event key
    expect(String(logged?.event_id)).not.toContain("a@b.co");
  });
});
