import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Part 3.1 — what a Paystack AI plan event may GRANT. Drives the REAL webhook route, the real
 * plan-webhook / plan-attempts modules, the real syncAiPlanEvent and upsertAiSubscription over an
 * in-memory database. Only the HMAC check is bypassed, and Paystack's verify / plan read are scripted.
 */

let db: FakeDb;
let verifyAnswer: (ref: string) => unknown;
let planFacts: { amount: number; currency: string };
const verifyCalls: string[] = [];
const welcomes: string[] = [];

/** a real query returns a snapshot; the fake returns live rows — copy them (see reconcile-sweep.test.ts) */
function snapshotClient(c: ReturnType<FakeDb["client"]>) {
  const wrap = (b: Record<string, unknown>): Record<string, unknown> =>
    new Proxy(b, {
      get(target, p) {
        if (p === "then") return (res: (r: unknown) => unknown, rej?: (e: unknown) => unknown) => (target.then as (a: (r: { data: unknown }) => unknown, b?: unknown) => Promise<unknown>)((r) => res({ ...r, data: r.data ? structuredClone(r.data) : r.data }), rej);
        const v = target[p as string];
        return typeof v === "function" ? (...a: unknown[]) => {
          const out = (v as (...x: unknown[]) => unknown).apply(target, a);
          return out === target ? wrap(target) : out;
        } : v;
      },
    });
  const client = c as unknown as { from: (t: string) => Record<string, unknown>; rpc: unknown };
  return { ...client, from: (t: string) => wrap(client.from(t)) };
}

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void Promise.resolve().then(fn) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => snapshotClient(db.client()) }));
vi.mock("@/lib/ai/credits/plan-welcome", () => ({ welcomeAiPlan: async (_u: string, plan: string) => void welcomes.push(plan) }));
vi.mock("@/lib/analytics/events", () => ({ trackEvent: () => {} }));
vi.mock("@/lib/landing/settings", async () => {
  const { normalizeAiWalletConfig } = await import("@/lib/ai/credits/wallet-config");
  return {
    getLandingSettings: async () => ({
      frenzAiCurrency: "USD",
      frenzAiPlans: { enabled: true, wallet: normalizeAiWalletConfig(null), plans: { ai_pro: { enabled: true, label: "AI Pro", priceCents: 1000, paystackPlanCode: "PLN_pro" }, ai_max: { enabled: true, label: "AI Max", priceCents: 2000, paystackPlanCode: "PLN_max" } } },
    }),
  };
});
vi.mock("@/lib/paystack/paystack", async (orig) => ({
  ...(await orig<typeof import("@/lib/paystack/paystack")>()),
  verifyPaystackSignature: async () => true,
  paystackEnabled: async () => true,
  verifyTransaction: async (ref: string) => (verifyCalls.push(ref), verifyAnswer(ref)),
  readPaystackPlan: async (code: string) => ({ planCode: code, name: "x", interval: "monthly", active: true, ...planFacts }),
}));

const { POST } = await import("./route");
const { settleOwnPlanAttempt } = await import("@/lib/ai/credits/plan-attempts");
const { getLandingSettings } = await import("@/lib/landing/settings");
const { PaystackHttpError } = await import("@/lib/paystack/paystack");

const USER = "11111111-1111-4111-8111-111111111111";
const REF = "frenz_ai_plan_2b1c8f8e-1111-4111-8111-111111111111";
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const meta = { user_id: USER, purpose: "frenz_ai_plan", ai_plan: "ai_pro" };
const charge = (ref: string, over: Record<string, unknown> = {}) => ({ id: 501, reference: ref, status: "success", amount: 1_500_000, currency: "NGN", paid_at: new Date().toISOString(), metadata: meta, plan: "PLN_pro", ...over });
const deliver = (event: string, data: Record<string, unknown>) => POST(new Request("https://frenzsave.com/api/paystack/webhook", { method: "POST", headers: { "x-paystack-signature": "t" }, body: JSON.stringify({ event, data }) }));
const subs = () => db.tables.ai_subscriptions ?? [];
const attempt = () => db.tables.ai_topup_attempts!.find((r) => r.reference === REF)!;
const audits = () => (db.tables.financial_audit_log ?? []).filter((r) => r.action === "ai_plan_payment_review");
const seedAttempt = (over: Record<string, unknown> = {}) =>
  db.tables.ai_topup_attempts!.push({ id: REF, reference: REF, user_id: USER, provider: "paystack", purpose: "ai_subscription", status: "pending", item_id: "ai_pro", amount_cents: 1000, currency: "USD", provider_amount: 1_500_000, provider_currency: "NGN", checkout_url: "https://checkout.paystack.com/x", created_at: ago(60_000), updated_at: ago(60_000), ...over });
/** the webhook payload: what the signed body CLAIMS (never trusted for value) */
const firstCharge = (over: Record<string, unknown> = {}) => ({ reference: REF, status: "success", amount: 1_500_000, currency: "NGN", metadata: meta, plan: { plan_code: "PLN_pro" }, customer: { email: "a@b.co", customer_code: "CUS_1" }, ...over });

beforeEach(() => {
  db = fakeDb({ ai_topup_attempts: [], ai_subscriptions: [], payment_provider_events: [], financial_audit_log: [], profiles: [] });
  db.unique.payment_provider_events = [["provider", "event_id"]];
  verifyCalls.length = 0;
  welcomes.length = 0;
  planFacts = { amount: 1_500_000, currency: "NGN" };
  verifyAnswer = (ref) => charge(ref);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("first purchase with OUR reference — the attempt decides, re-verified with Paystack", () => {
  it("a valid signed webhook + a matching verified transaction activates the plan once and closes the attempt", async () => {
    seedAttempt();
    expect((await deliver("charge.success", firstCharge())).status).toBe(200);
    expect(verifyCalls).toEqual([REF]);
    expect(subs()).toHaveLength(1);
    expect(subs()[0]).toMatchObject({ user_id: USER, plan: "ai_pro", status: "active", last_reference: REF });
    expect(attempt().status).toBe("success");
  });

  it("🔴 the body says the right amount but Paystack's verified record says less → no plan, attempt held as mismatch", async () => {
    seedAttempt();
    verifyAnswer = (ref) => charge(ref, { amount: 1_499_999 });
    expect((await deliver("charge.success", firstCharge())).status).toBe(200);
    expect(subs()).toHaveLength(0);
    expect(attempt().status).toBe("mismatch");
  });

  it("wrong currency, wrong member or wrong plan on the verified record → no plan", async () => {
    for (const over of [{ currency: "USD", amount: 1000 }, { metadata: { ...meta, user_id: "someone-else" } }, { metadata: { ...meta, ai_plan: "ai_max" } }]) {
      db.tables.ai_topup_attempts = [];
      db.tables.ai_subscriptions = [];
      db.tables.payment_provider_events = [];
      seedAttempt();
      verifyAnswer = (ref) => charge(ref, over);
      await deliver("charge.success", firstCharge());
      expect(subs(), JSON.stringify(over)).toHaveLength(0);
      expect(attempt().status).toBe("mismatch");
    }
  });

  it("the webhook arrives BEFORE the browser return: the return then answers settled — no second activation", async () => {
    seedAttempt();
    await deliver("charge.success", firstCharge());
    const config = (await getLandingSettings()).frenzAiPlans;
    expect(await settleOwnPlanAttempt(USER, REF, config as never)).toBe("settled");
    expect(verifyCalls).toHaveLength(1);
    expect(subs()).toHaveLength(1);
  });

  it("the webhook arrives AFTER the cron settled it: acknowledged, Paystack not asked again", async () => {
    seedAttempt({ status: "success" });
    expect((await deliver("charge.success", firstCharge())).status).toBe(200);
    expect(verifyCalls).toEqual([]);
  });

  it("a duplicate delivery is acknowledged without work; concurrent deliveries activate once", async () => {
    seedAttempt();
    const [a, b] = await Promise.all([deliver("charge.success", firstCharge()), deliver("charge.success", firstCharge())]);
    expect([a.status, b.status].every((s) => s === 200 || s === 500)).toBe(true);
    expect(subs()).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 0));
    // exactly one verification and one activation; the other delivery is told to retry (500) while the lease is held
    expect(verifyCalls).toHaveLength(1);
    expect(welcomes).toHaveLength(1);
    const again = await deliver("charge.success", firstCharge());
    expect(again.status).toBe(200);
    expect(subs()).toHaveLength(1);
  });

  it("Paystack verify times out or answers 5xx → 500 (redelivered); no plan, the attempt stays open", async () => {
    seedAttempt();
    verifyAnswer = () => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    };
    expect((await deliver("charge.success", firstCharge())).status).toBe(500);
    expect(subs()).toHaveLength(0);
    expect(attempt().status).toBe("pending");
    attempt().updated_at = ago(60_000);
    verifyAnswer = () => {
      throw new PaystackHttpError("upstream", 502);
    };
    expect((await deliver("charge.success", firstCharge())).status).toBe(500);
    expect(subs()).toHaveLength(0);
  });

  it("subscription.create arriving before the first charge is verified is retried — never a grant on its own", async () => {
    seedAttempt();
    const created = { subscription_code: "SUB_1", plan: { plan_code: "PLN_pro" }, customer: { email: "a@b.co", customer_code: "CUS_1" }, metadata: meta, email_token: "tok" };
    expect((await deliver("subscription.create", created)).status).toBe(500);
    expect(subs()).toHaveLength(0);
    await deliver("charge.success", firstCharge());
    // the redelivery now finds the established subscription and records its references
    expect((await deliver("subscription.create", created)).status).toBe(200);
    expect(subs()[0]).toMatchObject({ subscription_ref: "SUB_1", status: "active", plan: "ai_pro" });
  });
});

describe("recurring Paystack subscriptions keep their established flow", () => {
  const established = () =>
    db.tables.ai_subscriptions!.push({ id: "s1", user_id: USER, plan: "ai_pro", status: "active", provider: "paystack", subscription_ref: "SUB_1", customer_ref: "CUS_1", activated_at: ago(40 * 86_400_000), last_reference: "T_FIRST", cancel_at_period_end: false });

  it("a renewal charge (Paystack's own reference) renews the member's subscription — no one-time attempt needed, no re-verify", async () => {
    established();
    const res = await deliver("charge.success", { reference: "T_RENEW_2", status: "success", amount: 1_500_000, currency: "NGN", plan: { plan_code: "PLN_pro" }, customer: { customer_code: "CUS_1", email: "a@b.co" }, subscription_code: "SUB_1" });
    expect(res.status).toBe(200);
    expect(verifyCalls).toEqual([]);
    expect(subs()[0]).toMatchObject({ status: "active", last_reference: "T_RENEW_2" });
  });

  it("invoice.update, invoice.payment_failed and subscription.disable follow the established path", async () => {
    established();
    expect((await deliver("invoice.payment_failed", { subscription_code: "SUB_1", plan: { plan_code: "PLN_pro" }, customer: { customer_code: "CUS_1" } })).status).toBe(200);
    expect(subs()[0]!.status).toBe("past_due");
    expect((await deliver("invoice.update", { subscription_code: "SUB_1", plan: { plan_code: "PLN_pro" }, customer: { customer_code: "CUS_1" } })).status).toBe(200);
    expect(subs()[0]!.status).toBe("active");
    expect((await deliver("subscription.disable", { subscription_code: "SUB_1", plan: { plan_code: "PLN_pro" }, customer: { customer_code: "CUS_1" } })).status).toBe(200);
    expect(subs()[0]!.status).toBe("canceled");
  });

  it("an event for ANOTHER subscription (or another plan) is not treated as a renewal of this one", async () => {
    established();
    planFacts = { amount: 3_000_000, currency: "NGN" };
    verifyAnswer = (ref) => charge(ref, { plan: "PLN_max", amount: 1_000, metadata: { ...meta, ai_plan: "ai_max" } });
    await deliver("charge.success", { reference: "T_MAX", status: "success", amount: 3_000_000, currency: "NGN", plan: { plan_code: "PLN_max" }, customer: { customer_code: "CUS_1" }, metadata: { ...meta, ai_plan: "ai_max" } });
    expect(subs()[0]!.plan).toBe("ai_pro"); // the forged/short AI Max charge upgraded nothing
    expect(audits()).toHaveLength(1);
  });
});

describe("legacy first purchases (no attempt row) — verified against Paystack's own records, or not granted", () => {
  const legacy = { reference: "T_LEGACY_1", status: "success", amount: 1_500_000, currency: "NGN", metadata: meta, plan: { plan_code: "PLN_pro" }, customer: { customer_code: "CUS_9", email: "a@b.co" } };

  it("re-verified: purpose, member, plan code, and amount + currency EXACTLY the Paystack plan's price → activated once", async () => {
    verifyAnswer = (ref) => charge(ref);
    expect((await deliver("charge.success", legacy)).status).toBe(200);
    expect(verifyCalls).toEqual(["T_LEGACY_1"]);
    expect(subs()).toHaveLength(1);
    expect(subs()[0]).toMatchObject({ user_id: USER, plan: "ai_pro", status: "active" });
  });

  it("verified amount differs from the plan's price → no plan, an audit entry for review", async () => {
    verifyAnswer = (ref) => charge(ref, { amount: 100 });
    expect((await deliver("charge.success", legacy)).status).toBe(200);
    expect(subs()).toHaveLength(0);
    expect(audits()[0]).toMatchObject({ reference: "T_LEGACY_1", details: expect.objectContaining({ reason: "amount_or_currency", review: "no plan granted" }) });
  });

  it("never granted from unverified metadata: Paystack unreachable → 500, no plan", async () => {
    verifyAnswer = () => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    };
    expect((await deliver("charge.success", legacy)).status).toBe(500);
    expect(subs()).toHaveLength(0);
  });

  it("subscription.create with no verified purchase and nothing in flight → no plan, logged for review", async () => {
    expect((await deliver("subscription.create", { subscription_code: "SUB_X", plan: { plan_code: "PLN_pro" }, customer: { email: "a@b.co", customer_code: "CUS_X" }, metadata: meta })).status).toBe(200);
    expect(subs()).toHaveLength(0);
    expect(audits()).toHaveLength(1);
  });
});
