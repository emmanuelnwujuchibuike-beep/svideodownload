import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VerifiedCharge } from "@/lib/payments/charge";
import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Owner, 2026-10-23: "Plans should be sent to Flutterwave not paystack, paystack only when Flutterwave is not
 * available or doesn't have the users supported payment method." The REAL checkout route, attempts module,
 * Flutterwave plan lifecycle, manage route and upsertAiSubscription over an in-memory database; every Flutterwave
 * and Paystack answer is scripted (no network).
 */

let db: FakeDb;
const calls: string[] = [];
let fwPlan: { id: string; amountMinor: number | null; currency: string; interval: string; active: boolean };
let fwCheckout: (o: { reference: string; paymentPlan?: string; amountMinor: number; currency: string }) => Promise<string>;
let fwVerify: (ref: string) => VerifiedCharge;
/** Flutterwave's subscriptions; `tx` = the FIRST charge each was created by (what ?transaction_id= finds, per the docs) */
let fwSubs: { id: string; status: string; plan: string; email: string; amount: number | null; tx?: string; renewalTxs?: string[] }[];
let fwCancel: (id: string) => Promise<void>;
let fwTransactions: { id: string; txRef: string | null; status: string; email: string | null }[];
let fwListError: Error | null;
let memberEmail = "a@b.co";
/** the AI Pro Flutterwave plan id the ADMIN has configured right now (a test may change it after checkout) */
let mockAiProPlanId = "123";

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: USER, email: memberEmail } } }) } }) }));
vi.mock("@/lib/rate-limit", () => ({ aiJobCreateLimiter: { limit: async () => ({ success: true }) } }));
vi.mock("@/lib/ai/credits/plan-welcome", () => ({ welcomeAiPlan: async () => {} }));
vi.mock("@/lib/analytics/events", () => ({ trackEvent: () => {} }));
vi.mock("@/lib/landing/settings", async () => {
  const { normalizeAiWalletConfig } = await import("@/lib/ai/credits/wallet-config");
  return {
    getLandingSettings: async () => ({
      frenzAiCurrency: "USD",
      frenzAiPlans: { enabled: true, wallet: normalizeAiWalletConfig(null), plans: { ai_pro: { enabled: true, label: "AI Pro", priceCents: 1000, interval: "monthly", paystackPlanCode: "PLN_pro", flutterwavePlanId: mockAiProPlanId }, ai_max: { enabled: true, label: "AI Max", priceCents: 2000, interval: "monthly", paystackPlanCode: "PLN_max", flutterwavePlanId: "" } } },
      frenzAiCharacterReplace: { recharge: { checkoutCurrency: "NGN" } },
    }),
  };
});
// the live rate for the naira months in Nigeria (2026-10-24): ₦1,600 per dollar
vi.mock("@/lib/ai/character-replace/fx-rate-server", () => ({ resolveCheckoutRate: async () => ({ minorPerUsd: 160_000 }) }));
vi.mock("@/lib/paystack/paystack", async (orig) => ({
  ...(await orig<typeof import("@/lib/paystack/paystack")>()),
  paystackEnabled: async () => true,
  readPaystackPlan: async () => ({ planCode: "PLN_pro", name: "AI Pro", amount: 1_500_000, currency: "NGN", interval: "monthly", active: true }),
  initializeTransaction: async (o: { reference?: string }) => (calls.push(`paystack:init:${db.tables.ai_topup_attempts?.some((r) => r.reference === o.reference) ? "row-first" : "NO-ROW"}`), `https://checkout.paystack.com/${o.reference}`),
}));
vi.mock("@/lib/flutterwave/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/flutterwave/client")>()),
  readFlutterwavePlan: async () => (calls.push("fw:plan"), fwPlan),
  createFlutterwaveCheckout: async (o: { reference: string; paymentPlan?: string; amountMinor: number; currency: string }) => (calls.push(`fw:checkout:${o.paymentPlan}:${o.amountMinor}:${o.currency}:${db.tables.ai_topup_attempts?.some((r) => r.reference === o.reference) ? "row-first" : "NO-ROW"}`), fwCheckout(o)),
  verifyFlutterwaveByReference: async (ref: string) => fwVerify(ref),
  verifyFlutterwaveById: async (id: string) => fwVerify(id),
  // the documented filters; a renewal's transaction id is only found when the scenario says Flutterwave links it
  findFlutterwaveSubscriptions: async (q: { email?: string; plan?: string; transactionId?: string }) =>
    fwSubs.filter((s) => (!q.transactionId || s.tx === q.transactionId || (s.renewalTxs ?? []).includes(q.transactionId)) && (!q.email || s.email === q.email) && (!q.plan || s.plan === q.plan)),
  cancelFlutterwaveSubscription: async (id: string) => (calls.push(`fw:cancel:${id}`), fwCancel(id)),
  listFlutterwaveTransactions: async () => {
    if (fwListError) throw fwListError;
    return { items: fwTransactions, totalPages: 1 };
  },
}));

const USER = "11111111-1111-4111-8111-111111111111";
const ENV = { FLUTTERWAVE_SECRET_KEY: "FLWSECK_TEST-k", FLUTTERWAVE_SECRET_HASH: "h", FLUTTERWAVE_VERIFIED_CURRENCIES: "USD", FLUTTERWAVE_ENABLED_PURPOSES: "ai_subscription", FLUTTERWAVE_AMOUNT_UNIT: "major" };
const setEnv = (on: boolean) => {
  for (const [k, v] of Object.entries(ENV)) {
    if (on) process.env[k] = v;
    else delete process.env[k];
  }
};

const { POST } = await import("@/app/api/ai/subscriptions/checkout/route");
const { POST: MANAGE } = await import("@/app/api/ai/subscriptions/manage/route");
const { reconcilePendingPlanAttempts } = await import("./plan-attempts");
const { handleFlutterwaveRenewal, handleFlutterwaveSubscriptionCancelled, activateFlutterwavePlan, reconcileFlutterwaveRenewals, applyReviewedRenewal } = await import("./flutterwave-plans");
const { subscriptionIsActive } = await import("./subscription");
const { scriptPlanBillingRpcs } = await import("@/lib/testing/plan-billing-model");
const { getLandingSettings } = await import("@/lib/landing/settings");
const { FlutterwaveHttpError } = await import("@/lib/flutterwave/client");

const checkout = (body: Record<string, unknown> = { plan: "ai_pro" }, country?: string) => POST(new Request("https://frenzsave.com/api/ai/subscriptions/checkout", { method: "POST", headers: { "content-type": "application/json", ...(country ? { "cf-ipcountry": country } : {}) }, body: JSON.stringify(body) }));
const attempts = () => (db.tables.ai_topup_attempts ?? []).filter((r) => r.purpose === "ai_subscription");
const subs = () => db.tables.ai_subscriptions ?? [];
const config = async () => (await getLandingSettings()).frenzAiPlans as never;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const fwCharge = (ref: string | null, over: Partial<VerifiedCharge> = {}): VerifiedCharge => ({ provider: "flutterwave", reference: ref, externalId: "901", status: "success", amountMinor: 1000, currency: "USD", channel: "card", paidAt: "2026-10-23T10:00:00.000Z", reason: null, customerEmail: "a@b.co", ...over });

beforeEach(() => {
  db = fakeDb({ ai_topup_attempts: [], ai_subscriptions: [], subscriptions: [], financial_audit_log: [], plan_renewals: [], plan_billing_reviews: [] });
  db.unique.ai_topup_attempts = [["reference"]];
  scriptPlanBillingRpcs(db);
  calls.length = 0;
  memberEmail = "a@b.co";
  mockAiProPlanId = "123";
  fwPlan = { id: "123", amountMinor: 1000, currency: "USD", interval: "monthly", active: true };
  fwCheckout = async (o) => `https://checkout.flutterwave.com/pay/${o.reference}`;
  fwVerify = (ref) => fwCharge(ref);
  // the subscription Flutterwave creates for a first charge (transaction 901)
  fwSubs = [{ id: "55", status: "active", plan: "123", email: "a@b.co", amount: 10, tx: "901" }];
  // cancelling at Flutterwave really cancels there (what the member's cancel then confirms)
  fwCancel = async (id) => {
    for (const s of fwSubs) if (s.id === id) s.status = "cancelled";
  };
  fwTransactions = [];
  fwListError = null;
  delete process.env.FLUTTERWAVE_RENEWAL_TX_LOOKUP;
  setEnv(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("plan checkout — Flutterwave first, Paystack the backup", () => {
  it("Flutterwave usable: the USD payment plan, the plan's own price, the attempt written FIRST; Paystack untouched", async () => {
    const res = await checkout();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ provider: "flutterwave" });
    expect(calls).toEqual(["fw:plan", "fw:checkout:123:1000:USD:row-first"]);
    expect(attempts()[0]).toMatchObject({ provider: "flutterwave", item_id: "ai_pro", provider_amount: 1000, provider_currency: "USD", reference: expect.stringMatching(/^frenz_ai_plan_fw_/) });
  });

  it("Flutterwave not available (its gate closed) → Paystack, exactly as before", async () => {
    setEnv(false);
    expect(await (await checkout()).json()).toMatchObject({ provider: "paystack" });
    expect(calls).toEqual(["paystack:init:row-first"]);
  });

  it("a plan with no Flutterwave plan id → Paystack", async () => {
    expect(await (await checkout({ plan: "ai_max" })).json()).toMatchObject({ provider: "paystack" });
    expect(calls.some((c) => c.startsWith("fw:"))).toBe(false);
  });

  it("the member picked Paystack (bank transfer / USSD — what Flutterwave plans can't take) → Paystack", async () => {
    expect(await (await checkout({ plan: "ai_pro", provider: "paystack" })).json()).toMatchObject({ provider: "paystack" });
    expect(calls.some((c) => c.startsWith("fw:checkout"))).toBe(false);
  });

  it("Flutterwave DEFINITELY refused → its attempt closed, then Paystack opens", async () => {
    fwCheckout = async () => {
      throw new FlutterwaveHttpError("Invalid plan", 400);
    };
    expect(await (await checkout()).json()).toMatchObject({ provider: "paystack" });
    expect(attempts().map((a) => [a.provider, a.status]).sort()).toEqual([["flutterwave", "failed"], ["paystack", "pending"]]);
  });

  it("🔴 Flutterwave outcome UNKNOWN (timeout) → held; Paystack is NOT opened, the next tap waits", async () => {
    fwCheckout = async () => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    };
    const res = await checkout();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "PAYMENT_CONFIRMING" });
    expect(calls.some((c) => c.startsWith("paystack"))).toBe(false);
    expect(attempts()[0]).toMatchObject({ provider: "flutterwave", status: "verification_required" });
    fwVerify = (ref) => fwCharge(ref, { status: "pending" });
    expect((await checkout()).status).toBe(409);
    expect(calls.filter((c) => c.startsWith("fw:checkout"))).toHaveLength(1);
  });

  it("a Flutterwave plan that isn't USD (misconfigured) is never charged → Paystack", async () => {
    fwPlan = { ...fwPlan, currency: "NGN" };
    expect(await (await checkout()).json()).toMatchObject({ provider: "paystack" });
    expect(calls.some((c) => c.startsWith("fw:checkout"))).toBe(false);
  });

  it("🔴 Part 6: a USD plan whose amount differs from the AI plan's shown price ($10.00) is never charged — Paystack's plan takes it", async () => {
    for (const amountMinor of [999, 1001, 2000, 199]) {
      calls.length = 0;
      // each try starts clean (an open Paystack attempt from the previous try would be handed back instead)
      db.tables.ai_topup_attempts = [];
      fwPlan = { ...fwPlan, amountMinor };
      expect(await (await checkout()).json(), String(amountMinor)).toMatchObject({ provider: "paystack" });
      expect(calls.some((c) => c.startsWith("fw:checkout"))).toBe(false);
    }
  });

  it("Part 6: a yearly Flutterwave plan is never sold as the monthly AI plan", async () => {
    fwPlan = { ...fwPlan, interval: "yearly" };
    expect(await (await checkout()).json()).toMatchObject({ provider: "paystack" });
  });
});

describe("activation — the subscription is PROVEN and its contract stored (Part 3.3, H1)", () => {
  const settle = async () => {
    for (const r of attempts()) {
      r.created_at = ago(20 * 60_000);
      r.updated_at = ago(20 * 60_000);
    }
    return reconcilePendingPlanAttempts(await config());
  };

  it("a paid first charge activates the plan for one interval WITH the Flutterwave subscription id and the contract — once", async () => {
    await checkout();
    expect(await settle()).toMatchObject({ settled: 1 });
    expect(subs()[0]).toMatchObject({ user_id: USER, plan: "ai_pro", status: "active", provider: "flutterwave", plan_code: "123", subscription_ref: "55", customer_ref: "a@b.co", contract_amount_minor: 1000, contract_currency: "USD", contract_interval: "monthly", current_period_start: "2026-10-23T10:00:00.000Z", current_period_end: "2026-11-23T10:00:00.000Z" });
    expect(attempts()[0]).toMatchObject({ status: "success", charge_id: "901" });
    expect(await settle()).toMatchObject({ examined: 0 });
  });

  it("paid, but Flutterwave shows no subscription for that charge yet → NO plan, the attempt stays open, a review says why; then it settles", async () => {
    fwSubs = [];
    await checkout();
    expect(await settle()).toMatchObject({ settled: 0 });
    expect(subs()).toHaveLength(0);
    expect(attempts()[0]!.status).not.toBe("success");
    expect(db.tables.plan_billing_reviews).toEqual([expect.objectContaining({ kind: "activation", status: "open", transaction_id: "901" })]);
    fwSubs = [{ id: "55", status: "active", plan: "123", email: "a@b.co", amount: 10, tx: "901" }];
    expect(await settle()).toMatchObject({ settled: 1 });
    expect(subs()[0]).toMatchObject({ subscription_ref: "55" });
  });

  it("a subscription on ANOTHER plan, for another customer, or at another amount → no plan, a review (never a guess)", async () => {
    for (const bad of [{ plan: "999" }, { email: "someone@else.co" }, { amount: 20 }]) {
      db.tables.ai_topup_attempts = [];
      db.tables.ai_subscriptions = [];
      db.tables.plan_billing_reviews = [];
      fwSubs = [{ id: "55", status: "active", plan: "123", email: "a@b.co", amount: 10, tx: "901", ...bad }];
      await checkout();
      expect(await settle()).toMatchObject({ mismatched: 1 });
      expect(subs()).toHaveLength(0);
      expect(db.tables.plan_billing_reviews).toHaveLength(1);
    }
  });

  it("an overpaid or underpaid first charge activates nothing — held as a mismatch", async () => {
    for (const amount of [1001, 999]) {
      db.tables.ai_topup_attempts = [];
      await checkout();
      fwVerify = (ref) => fwCharge(ref, { amountMinor: amount });
      expect(await settle()).toMatchObject({ mismatched: 1 });
      expect(subs()).toHaveLength(0);
    }
  });

  it("AI Pro → AI Max on Flutterwave: the OLD subscription is cancelled by its stored id only AFTER the new one is active", async () => {
    subs().push({ user_id: USER, plan: "ai_pro", status: "active", provider: "flutterwave", plan_code: "123", subscription_ref: "44", customer_ref: "a@b.co", contract_amount_minor: 1000, contract_currency: "USD", contract_interval: "monthly", current_period_end: new Date(Date.now() + 9 * 86_400_000).toISOString(), cancel_at_period_end: false, activated_at: ago(86_400_000) });
    fwSubs = [
      { id: "44", status: "active", plan: "123", email: "a@b.co", amount: 10, tx: "700" },
      { id: "66", status: "active", plan: "124", email: "a@b.co", amount: 20, tx: "902" },
    ];
    const cfg = { ...(await config() as object), plans: { ai_pro: { enabled: true, label: "AI Pro", priceCents: 1000, interval: "monthly", flutterwavePlanId: "123" }, ai_max: { enabled: true, label: "AI Max", priceCents: 2000, interval: "monthly", flutterwavePlanId: "124" } } } as never;
    const out = await activateFlutterwavePlan({ userId: USER, plan: "ai_max", reference: "frenz_ai_plan_fw_upgrade", charge: fwCharge("frenz_ai_plan_fw_upgrade", { externalId: "902", amountMinor: 2000 }), config: cfg, planId: "124" });
    expect(out).toEqual({ ok: true });
    expect(subs()[0]).toMatchObject({ plan: "ai_max", subscription_ref: "66", contract_amount_minor: 2000 });
    expect(calls).toContain("fw:cancel:44");
    expect(fwSubs.find((s) => s.id === "44")!.status).toBe("cancelled");
    expect(db.tables.plan_billing_reviews).toEqual([]);
  });

  it("…and when cancelling the old one FAILS, the upgrade leaves a durable review (it may still charge)", async () => {
    subs().push({ user_id: USER, plan: "ai_pro", status: "active", provider: "flutterwave", plan_code: "123", subscription_ref: "44", customer_ref: "a@b.co", current_period_end: new Date(Date.now() + 9 * 86_400_000).toISOString(), cancel_at_period_end: false });
    fwSubs = [{ id: "44", status: "active", plan: "123", email: "a@b.co", amount: 10, tx: "700" }, { id: "66", status: "active", plan: "124", email: "a@b.co", amount: 20, tx: "902" }];
    fwCancel = async () => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    };
    const cfg = { ...(await config() as object), plans: { ai_pro: { enabled: true, label: "AI Pro", priceCents: 1000, interval: "monthly", flutterwavePlanId: "123" }, ai_max: { enabled: true, label: "AI Max", priceCents: 2000, interval: "monthly", flutterwavePlanId: "124" } } } as never;
    await activateFlutterwavePlan({ userId: USER, plan: "ai_max", reference: "frenz_ai_plan_fw_upgrade", charge: fwCharge("frenz_ai_plan_fw_upgrade", { externalId: "902", amountMinor: 2000 }), config: cfg, planId: "124" });
    expect(subs()[0]).toMatchObject({ plan: "ai_max", subscription_ref: "66" });
    expect(db.tables.plan_billing_reviews).toEqual([expect.objectContaining({ kind: "upgrade", status: "open", subscription_ref: "44" })]);
  });
});

describe("renewals — never on an email or a price (H1, H2)", () => {
  /** an AI subscriber whose subscription "55" was proven at activation, contract $10/month */
  const subscriber = (over: Record<string, unknown> = {}) =>
    subs().push({ user_id: USER, plan: "ai_pro", status: "active", provider: "flutterwave", plan_code: "123", subscription_ref: "55", customer_ref: "a@b.co", contract_amount_minor: 1000, contract_currency: "USD", contract_interval: "monthly", last_reference: "frenz_ai_plan_fw_x", current_period_start: ago(29 * 86_400_000), current_period_end: new Date(Date.now() + 86_400_000).toISOString(), activated_at: ago(29 * 86_400_000), cancel_at_period_end: false, ...over });
  const renewal = (tx: string, over: Partial<VerifiedCharge> = {}) => fwCharge("Links-616626414629", { externalId: tx, ...over });
  const end = () => Date.parse(String(subs()[0]!.current_period_end));
  const confirmLookup = () => (process.env.FLUTTERWAVE_RENEWAL_TX_LOOKUP = "confirmed");

  it("DEFAULT (no sandbox proof yet): a subscriber's charge is a REVIEW for an admin — no time added, queued once", async () => {
    subscriber();
    const before = end();
    expect(await handleFlutterwaveRenewal(renewal("777"))).toEqual({ ack: true, final: true, outcome: "renewal:review" });
    expect(await handleFlutterwaveRenewal(renewal("777"), { source: "reconcile" })).toEqual({ ack: true, final: true, outcome: "renewal:review" });
    expect(end()).toBe(before);
    // Part 3.3.2 (H1): the email match is NOT written as a target — no member, no subscription, no plan on the review
    expect(db.tables.plan_billing_reviews).toEqual([expect.objectContaining({ kind: "renewal", transaction_id: "777", target: null, user_id: null, subscription_ref: null, plan_code: null, amount_minor: 1000, currency: "USD" })]);
    expect(String(db.tables.plan_billing_reviews![0]!.reason)).toMatch(/not proven|cannot be proven/);
    expect(String(db.tables.plan_billing_reviews![0]!.reason)).not.toContain("a@b.co");
    expect(db.tables.plan_renewals).toEqual([]);
  });

  it("🔴 INVERTED (Part 3.3.2, H1): an admin can NOT apply an email-only review — nothing extended, the review stays open", async () => {
    subscriber();
    const before = end();
    await handleFlutterwaveRenewal(renewal("777"));
    fwVerify = (id) => renewal(id);
    const id = String(db.tables.plan_billing_reviews![0]!.id);
    expect(await applyReviewedRenewal(id, "admin-1")).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/Ownership not proven/) });
    expect(end()).toBe(before);
    expect(db.tables.plan_billing_reviews![0]!.status).toBe("open");
    expect(db.tables.plan_renewals).toEqual([]);
  });

  it("a one-off / Payment Link charge on the SAME email and amount (Flutterwave links it to no subscription) extends nothing", async () => {
    confirmLookup();
    subscriber();
    const before = end();
    expect(await handleFlutterwaveRenewal(renewal("801"))).toMatchObject({ outcome: "renewal:review" });
    expect(end()).toBe(before);
    expect(db.tables.plan_renewals).toEqual([]);
  });

  it("a charge from an email we bill nothing to is not ours — ignored, no review", async () => {
    subscriber();
    expect(await handleFlutterwaveRenewal(renewal("802", { customerEmail: "stranger@x.co" }))).toEqual({ ack: true, final: true, outcome: "renewal:not_ours" });
    expect(db.tables.plan_billing_reviews).toEqual([]);
  });

  it("PROVEN (lookup confirmed + Flutterwave ties the transaction to the stored subscription): extended once; a redelivery is a duplicate", async () => {
    confirmLookup();
    subscriber();
    fwSubs[0]!.renewalTxs = ["777"];
    const before = end();
    expect(await handleFlutterwaveRenewal(renewal("777"))).toEqual({ ack: true, final: true, outcome: "renewal:applied" });
    const after = end();
    expect(after - before).toBeGreaterThan(27 * 86_400_000);
    expect(await handleFlutterwaveRenewal(renewal("777"))).toEqual({ ack: true, final: true, outcome: "renewal:duplicate" });
    expect(end()).toBe(after);
    expect(db.tables.plan_renewals).toHaveLength(1);
  });

  it("the CONTRACT decides, not today's admin price: an admin change to $20 leaves a $10 renewal valid and a $20 one in review", async () => {
    confirmLookup();
    subscriber();
    fwSubs[0]!.renewalTxs = ["777", "778"];
    fwPlan = { ...fwPlan, amountMinor: 2000 };
    expect(await handleFlutterwaveRenewal(renewal("777"))).toMatchObject({ outcome: "renewal:applied" });
    expect(await handleFlutterwaveRenewal(renewal("778", { amountMinor: 2000 }))).toMatchObject({ outcome: "renewal:review" });
    expect(db.tables.plan_billing_reviews![0]).toMatchObject({ reason: expect.stringMatching(/^not applied: contract_mismatch/), subscription_ref: null, user_id: null });
  });

  it("another currency or another plan on the subscription → review, no time", async () => {
    confirmLookup();
    subscriber();
    fwSubs[0]!.renewalTxs = ["779"];
    const before = end();
    expect(await handleFlutterwaveRenewal(renewal("779", { currency: "NGN" }))).toMatchObject({ outcome: "renewal:review" });
    db.tables.plan_billing_reviews = [];
    fwSubs[0]!.plan = "999";
    fwSubs[0]!.renewalTxs = ["780"];
    expect(await handleFlutterwaveRenewal(renewal("780"))).toMatchObject({ outcome: "renewal:review" });
    expect(end()).toBe(before);
  });

  it("a renewal that lands after the member cancelled keeps the cancel flag (M2)", async () => {
    confirmLookup();
    subscriber({ cancel_at_period_end: true });
    fwSubs[0]!.renewalTxs = ["781"];
    expect(await handleFlutterwaveRenewal(renewal("781"))).toMatchObject({ outcome: "renewal:applied" });
    expect(subs()[0]!.cancel_at_period_end).toBe(true);
  });

  it("🔴 the ledger can't be reached → a RETRY is asked for; nothing extended, nothing marked processed (never fails open)", async () => {
    confirmLookup();
    subscriber();
    fwSubs[0]!.renewalTxs = ["782"];
    db.rpc.apply_plan_renewal = () => ({ data: null, error: { message: "connection reset" } });
    const before = end();
    expect(await handleFlutterwaveRenewal(renewal("782"))).toEqual({ ack: false, final: false, outcome: "renewal:ledger_unavailable" });
    expect(end()).toBe(before);
  });

  it("a pending charge is acknowledged but NOT final — its later 'successful' delivery is still processed", async () => {
    subscriber();
    expect(await handleFlutterwaveRenewal(renewal("783", { status: "pending" }))).toEqual({ ack: true, final: false, outcome: "renewal:pending" });
  });
});

describe("cancellation (H3, H4, M1)", () => {
  const subscriber = (over: Record<string, unknown> = {}) =>
    subs().push({ user_id: USER, plan: "ai_pro", status: "active", provider: "flutterwave", plan_code: "123", subscription_ref: "55", customer_ref: "a@b.co", contract_amount_minor: 1000, contract_currency: "USD", contract_interval: "monthly", current_period_end: new Date(Date.now() + 10 * 86_400_000).toISOString(), activated_at: ago(86_400_000), cancel_at_period_end: false, ...over });
  /** the documented payload: data.plan is an OBJECT */
  const cancelled = (planId: number | string = 123, email = "a@b.co") => ({ status: "deactivated", currency: "USD", amount: 10, customer: { email, full_name: "Anonymous customer" }, plan: { id: planId, name: "AI Pro", amount: 10, currency: "USD", interval: "monthly", duration: 0, status: "cancel", date_created: "2026-10-01T00:00:00.000Z" } });

  it("the documented payload (plan as an object), confirmed cancelled at Flutterwave → cancel at period end; paid access kept to the paid-through time, no further", async () => {
    subscriber();
    fwSubs[0]!.status = "cancelled";
    expect(await handleFlutterwaveSubscriptionCancelled(cancelled())).toMatchObject({ ack: true, outcome: "cancel:confirmed" });
    const row = subs()[0]!;
    expect(row).toMatchObject({ status: "active", cancel_at_period_end: true });
    const endMs = Date.parse(String(row.current_period_end));
    expect(subscriptionIsActive(row as never, endMs - 1000)).toBe(true);
    // no renewal is coming: no 3-day grace after a cancellation
    expect(subscriptionIsActive(row as never, endMs + 86_400_000)).toBe(false);
  });

  it("still active at Flutterwave → nothing changes", async () => {
    subscriber();
    expect(await handleFlutterwaveSubscriptionCancelled(cancelled())).toMatchObject({ outcome: "cancel:still_active" });
    expect(subs()[0]!.cancel_at_period_end).toBe(false);
  });

  it("a plan id we don't hold for that customer, or an unreadable payload → a review; never routed to the AI plan by default", async () => {
    subscriber();
    expect(await handleFlutterwaveSubscriptionCancelled(cancelled(777))).toMatchObject({ outcome: "cancel:review" });
    expect(await handleFlutterwaveSubscriptionCancelled({ customer: { email: "a@b.co" }, plan: { name: "no id" } })).toMatchObject({ outcome: "cancel:unparsed" });
    expect(subs()[0]!.cancel_at_period_end).toBe(false);
    expect(db.tables.plan_billing_reviews!.map((r) => r.kind)).toEqual(["cancellation", "cancellation"]);
  });

  it("the member's own cancel: by the STORED subscription id, confirmed cancelled at Flutterwave, then recorded", async () => {
    subscriber();
    const ask = await (await MANAGE(new Request("https://frenzsave.com/api/ai/subscriptions/manage", { method: "POST" }))).json();
    expect(ask).toMatchObject({ confirmCancel: true });
    expect(calls).toEqual([]);
    const done = await (await MANAGE(new Request("https://frenzsave.com/api/ai/subscriptions/manage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "cancel" }) }))).json();
    expect(done).toMatchObject({ cancelled: true });
    expect(calls).toEqual(["fw:cancel:55"]);
    expect(subs()[0]).toMatchObject({ status: "active", cancel_at_period_end: true });
  });

  it("M1 — no stored subscription id, a timeout, or a cancel Flutterwave doesn't then show → NOT reported as cancelled", async () => {
    const cancelReq = () => MANAGE(new Request("https://frenzsave.com/api/ai/subscriptions/manage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "cancel" }) }));
    subscriber({ subscription_ref: null });
    expect((await cancelReq()).status).toBe(409);
    expect(subs()[0]!.cancel_at_period_end).toBe(false);
    expect(db.tables.plan_billing_reviews).toEqual([expect.objectContaining({ kind: "cancellation" })]);
    expect(calls).toEqual([]);

    db.tables.ai_subscriptions = [];
    subscriber();
    fwCancel = async () => {
      throw new FlutterwaveHttpError("upstream", 502);
    };
    expect((await cancelReq()).status).toBe(503);
    expect(subs()[0]!.cancel_at_period_end).toBe(false);

    fwCancel = async () => {}; // Flutterwave said OK, but still lists the subscription as active
    expect((await cancelReq()).status).toBe(503);
    expect(subs()[0]!.cancel_at_period_end).toBe(false);

    fwSubs = []; // …or doesn't list it at all
    expect((await cancelReq()).status).toBe(503);
    expect(subs()[0]!.cancel_at_period_end).toBe(false);
  });
});

describe("missed-renewal reconciliation (M6)", () => {
  const subscriber = () =>
    subs().push({ user_id: USER, plan: "ai_pro", status: "active", provider: "flutterwave", plan_code: "123", subscription_ref: "55", customer_ref: "a@b.co", contract_amount_minor: 1000, contract_currency: "USD", contract_interval: "monthly", current_period_end: new Date(Date.now() - 86_400_000).toISOString(), cancel_at_period_end: false });

  it("a charge the webhook missed is found, RE-VERIFIED by id and sent through the same path; a second run does nothing more", async () => {
    process.env.FLUTTERWAVE_RENEWAL_TX_LOOKUP = "confirmed";
    subscriber();
    fwSubs[0]!.renewalTxs = ["990"];
    fwTransactions = [{ id: "990", txRef: "Links-1", status: "successful", email: "a@b.co" }];
    fwVerify = (id) => fwCharge("Links-1", { externalId: id });
    expect(await reconcileFlutterwaveRenewals()).toMatchObject({ examined: 1, transactions: 1, applied: 1 });
    const end = subs()[0]!.current_period_end;
    expect(await reconcileFlutterwaveRenewals()).toMatchObject({ transactions: 0, applied: 0 });
    expect(subs()[0]!.current_period_end).toBe(end);
    expect(db.tables.plan_renewals).toHaveLength(1);
  });

  it("without the sandbox proof, a found charge is queued for review once — repeated runs add nothing", async () => {
    subscriber();
    fwTransactions = [{ id: "991", txRef: "Links-2", status: "successful", email: "a@b.co" }];
    fwVerify = (id) => fwCharge("Links-2", { externalId: id });
    expect(await reconcileFlutterwaveRenewals()).toMatchObject({ reviewed: 1 });
    expect(await reconcileFlutterwaveRenewals()).toMatchObject({ transactions: 0, reviewed: 0 });
    expect(db.tables.plan_billing_reviews).toHaveLength(1);
    expect(db.tables.plan_renewals).toEqual([]);
  });

  it("a FIRST charge of one of our attempts is never treated as a renewal; a rate limit stops the run", async () => {
    subscriber();
    db.tables.ai_topup_attempts!.push({ reference: "frenz_ai_plan_fw_a", user_id: USER, provider: "flutterwave", purpose: "ai_subscription", status: "success", charge_id: "992" });
    fwTransactions = [{ id: "992", txRef: "frenz_ai_plan_fw_a", status: "successful", email: "a@b.co" }];
    expect(await reconcileFlutterwaveRenewals()).toMatchObject({ transactions: 0 });
    fwListError = new FlutterwaveHttpError("Too many requests", 429);
    expect(await reconcileFlutterwaveRenewals()).toMatchObject({ rateLimited: true, applied: 0 });
  });
});

describe("Part 3.3.2 — admin Apply needs Flutterwave's proof AT APPLY TIME (H1, L3, L4)", () => {
  const OTHER = "22222222-2222-4222-8222-222222222222";
  /** member USER holds subscription 55 (contract $10/month); Flutterwave links renewal tx 777 to it */
  const setup = (rowOver: Record<string, unknown> = {}) => {
    subs().push({ user_id: USER, plan: "ai_pro", status: "active", provider: "flutterwave", plan_code: "123", subscription_ref: "55", customer_ref: "a@b.co", contract_amount_minor: 1000, contract_currency: "USD", contract_interval: "monthly", current_period_end: new Date(Date.now() + 86_400_000).toISOString(), cancel_at_period_end: false, ...rowOver });
    fwSubs[0]!.renewalTxs = ["777"];
    fwVerify = (id) => fwCharge("Links-1", { externalId: id });
    // a review queued while ownership could not be proven (no identity on it)
    db.tables.plan_billing_reviews!.push({ id: "rv-1", dedupe_key: "renewal:flutterwave:777", kind: "renewal", reason: "not proven", status: "open", transaction_id: "777", target: null, user_id: null, subscription_ref: null, plan_code: null, amount_minor: 1000, currency: "USD" });
    process.env.FLUTTERWAVE_RENEWAL_TX_LOOKUP = "confirmed";
  };
  const end = (u = USER) => Date.parse(String(subs().find((r) => r.user_id === u)!.current_period_end));
  const review = () => db.tables.plan_billing_reviews!.find((r) => r.id === "rv-1")!;

  it("PROVEN at apply time: a review with NO identity on it is applied to the subscription Flutterwave names — once; the review closes", async () => {
    setup();
    const before = end();
    expect(await applyReviewedRenewal("rv-1", "admin-1")).toEqual({ ok: true, result: "applied" });
    expect(end() - before).toBeGreaterThan(27 * 86_400_000);
    expect(review().status).toBe("applied");
    expect(db.tables.plan_renewals).toEqual([expect.objectContaining({ transaction_id: "777", user_id: USER, subscription_ref: "55", source: "admin", applied_by: "admin-1" })]);
  });

  it("renewal lookup not confirmed → refused, nothing extended", async () => {
    setup();
    delete process.env.FLUTTERWAVE_RENEWAL_TX_LOOKUP;
    const before = end();
    expect(await applyReviewedRenewal("rv-1", "admin-1")).toMatchObject({ ok: false, status: 409 });
    expect(end()).toBe(before);
  });

  it("zero or several subscriptions for the transaction, or one we don't store → refused", async () => {
    for (const subsNow of [[], [{ id: "55", status: "active", plan: "123", email: "a@b.co", amount: 10, renewalTxs: ["777"] }, { id: "56", status: "active", plan: "123", email: "a@b.co", amount: 10, renewalTxs: ["777"] }], [{ id: "99", status: "active", plan: "123", email: "a@b.co", amount: 10, renewalTxs: ["777"] }]]) {
      db.tables.ai_subscriptions = [];
      db.tables.plan_billing_reviews = [];
      fwSubs = [{ id: "55", status: "active", plan: "123", email: "a@b.co", amount: 10, tx: "901" }];
      setup();
      fwSubs = subsNow;
      const before = end();
      expect(await applyReviewedRenewal("rv-1", "admin-1")).toMatchObject({ ok: false, status: 409 });
      expect(end()).toBe(before);
    }
  });

  it("wrong plan, another customer, or a MISSING customer email (charge, subscription or stored row) → refused", async () => {
    const cases: [string, () => void][] = [
      ["plan", () => (fwSubs[0]!.plan = "999")],
      ["subscription customer", () => (fwSubs[0]!.email = "else@x.co")],
      ["missing subscription email", () => (fwSubs[0]!.email = "")],
      ["missing charge email", () => (fwVerify = (id) => fwCharge("Links-1", { externalId: id, customerEmail: null }))],
      ["missing stored email", () => (subs()[0]!.customer_ref = null)],
    ];
    for (const [name, mutate] of cases) {
      db.tables.ai_subscriptions = [];
      db.tables.plan_billing_reviews = [];
      fwSubs = [{ id: "55", status: "active", plan: "123", email: "a@b.co", amount: 10, tx: "901" }];
      setup();
      mutate();
      const before = end();
      const out = await applyReviewedRenewal("rv-1", "admin-1");
      expect(out, name).toMatchObject({ ok: false, status: 409 });
      expect(end(), name).toBe(before);
    }
  });

  it("re-verification: a different amount, currency or a non-success → refused; Flutterwave unreachable → 503, nothing applied", async () => {
    for (const over of [{ amountMinor: 2000 }, { currency: "NGN" }, { status: "failed" as const }]) {
      db.tables.ai_subscriptions = [];
      db.tables.plan_billing_reviews = [];
      setup();
      fwVerify = (id) => fwCharge("Links-1", { externalId: id, ...over });
      expect(await applyReviewedRenewal("rv-1", "admin-1")).toMatchObject({ ok: false, status: 409 });
    }
    db.tables.ai_subscriptions = [];
    db.tables.plan_billing_reviews = [];
    setup();
    fwVerify = () => {
      throw new Error("timeout");
    };
    expect(await applyReviewedRenewal("rv-1", "admin-1")).toMatchObject({ ok: false, status: 503 });
    expect(db.tables.plan_renewals).toEqual([]);
  });

  it("the subscription lookup fails at apply time → 503 (retry), nothing applied", async () => {
    setup();
    const lookup = fwSubs;
    fwSubs = new Proxy(lookup, { get: () => { throw new Error("network"); } }) as never;
    expect(await applyReviewedRenewal("rv-1", "admin-1")).toMatchObject({ ok: false, status: 503 });
    expect(db.tables.plan_renewals).toEqual([]);
  });

  it("the ledger errors or answers unclearly → never reported as success; a contract mismatch → refused", async () => {
    setup();
    db.rpc.apply_plan_renewal = () => ({ data: null, error: { message: "connection reset" } });
    expect(await applyReviewedRenewal("rv-1", "admin-1")).toMatchObject({ ok: false, status: 503 });
    db.rpc.apply_plan_renewal = () => ({ data: {}, error: null });
    expect(await applyReviewedRenewal("rv-1", "admin-1")).toMatchObject({ ok: false, status: 503 });
    db.rpc.apply_plan_renewal = () => ({ data: { result: "contract_mismatch" }, error: null });
    expect(await applyReviewedRenewal("rv-1", "admin-1")).toMatchObject({ ok: false, status: 409 });
    expect(review().status).toBe("open");
  });

  it("a FORGED or stale review naming ANOTHER member cannot move time to them — only the subscription Flutterwave proves gets it", async () => {
    setup();
    subs().push({ user_id: OTHER, plan: "ai_pro", status: "active", provider: "flutterwave", plan_code: "123", subscription_ref: "77", customer_ref: "other@x.co", contract_amount_minor: 1000, contract_currency: "USD", contract_interval: "monthly", current_period_end: new Date(Date.now() + 86_400_000).toISOString(), cancel_at_period_end: false });
    Object.assign(review(), { target: "ai_subscription", user_id: OTHER, subscription_ref: "77", plan_code: "123" });
    const otherBefore = end(OTHER);
    expect(await applyReviewedRenewal("rv-1", "admin-1")).toEqual({ ok: true, result: "applied" });
    expect(end(OTHER)).toBe(otherBefore);
    expect(db.tables.plan_renewals![0]).toMatchObject({ user_id: USER, subscription_ref: "55" });
  });

  it("L3 — already applied by the webhook: Apply answers 'already applied', closes the review, adds NO second period", async () => {
    setup();
    expect(await handleFlutterwaveRenewal(fwCharge("Links-1", { externalId: "777" }))).toMatchObject({ outcome: "renewal:applied" });
    review().status = "open"; // as if the review predates the webhook's success
    const after = end();
    expect(await applyReviewedRenewal("rv-1", "admin-1")).toEqual({ ok: true, result: "already_applied" });
    expect(review().status).toBe("applied");
    expect(end()).toBe(after);
    expect(db.tables.plan_renewals).toHaveLength(1);
  });
});

describe("Part 3.3.2 — activation hardening (L1, L2, M1) and the trusted contract source", () => {
  const settle = async () => {
    for (const r of attempts()) {
      r.created_at = ago(20 * 60_000);
      r.updated_at = ago(20 * 60_000);
    }
    return reconcilePendingPlanAttempts(await config());
  };

  it("the checkout stores the SERVER-chosen Flutterwave plan id with the attempt", async () => {
    await checkout();
    expect(attempts()[0]!.metadata).toEqual({ provider_plan_id: "123" });
  });

  it("L2 — the admin changes the plan id after checkout: activation is held to the STORED id (123), not today's (999)", async () => {
    await checkout();
    mockAiProPlanId = "999";
    expect(await settle()).toMatchObject({ settled: 1 });
    expect(subs()[0]).toMatchObject({ plan_code: "123", subscription_ref: "55" });
  });

  it("L2 — an attempt with NO stored plan id (from before 3.3.2) fails closed into review; never guessed from config", async () => {
    await checkout();
    delete attempts()[0]!.metadata;
    expect(await settle()).toMatchObject({ mismatched: 1 });
    expect(subs()).toHaveLength(0);
    expect(db.tables.plan_billing_reviews).toEqual([expect.objectContaining({ kind: "activation", reason: expect.stringMatching(/no stored Flutterwave plan id/) })]);
  });

  it("L1 — a missing charge email, or a missing subscription email, fails closed (mismatch + review)", async () => {
    for (const mutate of [() => (fwVerify = (ref: string) => fwCharge(ref, { customerEmail: null })), () => (fwSubs[0]!.email = "")]) {
      db.tables.ai_topup_attempts = [];
      db.tables.plan_billing_reviews = [];
      fwSubs = [{ id: "55", status: "active", plan: "123", email: "a@b.co", amount: 10, tx: "901" }];
      fwVerify = (ref) => fwCharge(ref);
      await checkout();
      mutate();
      expect(await settle()).toMatchObject({ mismatched: 1 });
      expect(subs()).toHaveLength(0);
      expect(db.tables.plan_billing_reviews).toHaveLength(1);
    }
  });

  it("several subscriptions for one first charge, or an unknown interval → fail closed", async () => {
    fwSubs = [{ id: "55", status: "active", plan: "123", email: "a@b.co", amount: 10, tx: "901" }, { id: "56", status: "active", plan: "123", email: "a@b.co", amount: 10, tx: "901" }];
    await checkout();
    expect(await settle()).toMatchObject({ mismatched: 1 });
    db.tables.ai_topup_attempts = [];
    fwSubs = [{ id: "55", status: "active", plan: "123", email: "a@b.co", amount: 10, tx: "901" }];
    await checkout();
    fwPlan = { ...fwPlan, interval: "every-3-weeks" };
    expect(await settle()).toMatchObject({ mismatched: 1 });
    expect(subs()).toHaveLength(0);
  });

  it("the subscription lookup errors → retryable: no plan, the attempt stays open; it settles once Flutterwave answers", async () => {
    await checkout();
    const real = fwSubs;
    fwSubs = new Proxy(real, { get: () => { throw new Error("network"); } }) as never;
    expect(await settle()).toMatchObject({ settled: 0, mismatched: 0 });
    expect(subs()).toHaveLength(0);
    expect(attempts()[0]!.status).not.toBe("mismatch");
    fwSubs = real;
    expect(await settle()).toMatchObject({ settled: 1 });
  });

  it("no amount on the subscription record → the contract is the VERIFIED first charge (matched exactly to the attempt, read from the plan's fixed amount)", async () => {
    fwSubs[0]!.amount = null;
    await checkout();
    expect(await settle()).toMatchObject({ settled: 1 });
    expect(subs()[0]).toMatchObject({ contract_amount_minor: 1000, contract_currency: "USD", contract_interval: "monthly" });
  });

  it("M1 — an AI plan whose Flutterwave plan has NO fixed amount never opens a Flutterwave checkout (no attempt); Paystack may follow", async () => {
    fwPlan = { ...fwPlan, amountMinor: null };
    expect(await (await checkout()).json()).toMatchObject({ provider: "paystack" });
    expect(calls.some((c) => c.startsWith("fw:checkout"))).toBe(false);
    expect(attempts().some((a) => a.provider === "flutterwave")).toBe(false);
  });
});

describe("Nigeria (2026-10-24) — AI plans: a one-off naira month, or a card subscription", () => {
  beforeEach(() => {
    process.env.FLUTTERWAVE_VERIFIED_CURRENCIES = "USD,NGN";
  });
  it("the default button: ONE month in naira ($10.00 at ₦1,600 = ₦16,000), no payment plan — every naira method shows", async () => {
    expect(await (await checkout({ plan: "ai_pro", provider: "flutterwave" }, "NG")).json()).toMatchObject({ provider: "flutterwave" });
    expect(calls).toEqual(["fw:checkout:undefined:1600000:NGN:row-first"]);
    expect(attempts()[0]).toMatchObject({ provider_currency: "NGN", provider_amount: 1_600_000, metadata: { one_off_period: "monthly" } });
  });
  it("the card button (no naira plan set): the USD payment plan, as everywhere else", async () => {
    expect(await (await checkout({ plan: "ai_pro", billing: "renew", provider: "flutterwave" }, "NG")).json()).toMatchObject({ provider: "flutterwave" });
    expect(calls).toEqual(["fw:plan", "fw:checkout:123:1000:USD:row-first"]);
  });
  it("outside Nigeria the body cannot ask for a naira month", async () => {
    await checkout({ plan: "ai_pro", billing: "once" }, "US");
    expect(calls).toEqual(["fw:plan", "fw:checkout:123:1000:USD:row-first"]);
  });
});
