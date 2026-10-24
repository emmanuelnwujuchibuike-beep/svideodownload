import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Part 3 — AI Pro / AI Max purchases: a durable attempt written BEFORE Paystack is called, and recovery
 * that activates the plan ONCE through the existing subscription write. The real checkout route, the
 * real attempts module and the real upsertAiSubscription over an in-memory database; Paystack scripted.
 */

let db: FakeDb;
const order: string[] = [];
let initAnswer: (o: { reference?: string }) => Promise<string>;
let verifyAnswer: (ref: string) => unknown;
const welcomes: string[] = [];

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void Promise.resolve().then(fn) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: USER, email: "a@b.co" } } }) } }) }));
vi.mock("@/lib/rate-limit", () => ({ aiJobCreateLimiter: { limit: async () => ({ success: true }) }, aiJobReadLimiter: { limit: async () => ({ success: true }) } }));
vi.mock("@/lib/ai/credits/plan-welcome", () => ({ welcomeAiPlan: async (_u: string, plan: string) => void welcomes.push(plan) }));
vi.mock("@/lib/analytics/events", () => ({ trackEvent: () => {} }));
vi.mock("@/lib/landing/settings", async () => {
  const { normalizeAiWalletConfig } = await import("@/lib/ai/credits/wallet-config");
  return {
    getLandingSettings: async () => ({
      frenzAiCurrency: "USD",
      frenzAiPlans: {
        enabled: true,
        wallet: normalizeAiWalletConfig(null),
        plans: {
          ai_pro: { enabled: true, label: "AI Pro", priceCents: 1000, paystackPlanCode: "PLN_pro" },
          ai_max: { enabled: true, label: "AI Max", priceCents: 2000, paystackPlanCode: "PLN_max" },
        },
      },
    }),
  };
});
vi.mock("@/lib/paystack/paystack", async (orig) => ({
  ...(await orig<typeof import("@/lib/paystack/paystack")>()),
  paystackEnabled: async () => true,
  readPaystackPlan: async () => ({ planCode: "PLN_pro", name: "AI Pro", amount: 1_500_000, currency: "NGN", interval: "monthly", active: true }),
  initializeTransaction: async (o: { reference?: string }) => {
    order.push(`init:${db.tables.ai_topup_attempts?.some((r) => r.reference === o.reference) ? "row-first" : "NO-ROW"}`);
    return initAnswer(o);
  },
  verifyTransaction: async (ref: string) => verifyAnswer(ref),
}));

const USER = "11111111-1111-4111-8111-111111111111";
const { POST } = await import("@/app/api/ai/subscriptions/checkout/route");
const { reconcilePendingPlanAttempts, isPlanReference } = await import("./plan-attempts");
const { getLandingSettings } = await import("@/lib/landing/settings");
const { PaystackHttpError } = await import("@/lib/paystack/paystack");

const checkout = (plan = "ai_pro") => POST(new Request("https://frenzsave.com/api/ai/subscriptions/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan }) }));
const attempts = () => (db.tables.ai_topup_attempts ?? []).filter((r) => r.purpose === "ai_subscription");
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const charge = (ref: string, over: Record<string, unknown> = {}) => ({ id: 77, reference: ref, status: "success", amount: 1_500_000, currency: "NGN", paid_at: new Date().toISOString(), metadata: { user_id: USER, purpose: "frenz_ai_plan", ai_plan: "ai_pro" }, ...over });
async function sweep() {
  // let every attempt be due (older than the 2-minute floor and the 5-minute recheck)
  for (const r of attempts()) {
    r.created_at = ago(20 * 60_000);
    r.updated_at = ago(20 * 60_000);
  }
  return reconcilePendingPlanAttempts((await getLandingSettings()).frenzAiPlans as never);
}

beforeEach(() => {
  db = fakeDb({ ai_topup_attempts: [], ai_subscriptions: [] });
  db.unique.ai_topup_attempts = [["reference"]];
  db.defaults.ai_topup_attempts = { updated_at: new Date(0).toISOString() };
  order.length = 0;
  welcomes.length = 0;
  initAnswer = async (o) => `https://checkout.paystack.com/${o.reference}`;
  verifyAnswer = (ref) => charge(ref);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("AI plan checkout — the attempt is written first", () => {
  it("9 · our reference, the member, the plan, Paystack, and the EXACT plan charge are stored BEFORE Paystack is called", async () => {
    const res = await checkout();
    expect(res.status).toBe(200);
    expect(order).toEqual(["init:row-first"]);
    const [a] = attempts();
    expect(isPlanReference(a!.reference)).toBe(true);
    expect(a).toMatchObject({ user_id: USER, provider: "paystack", purpose: "ai_subscription", item_id: "ai_pro", provider_amount: 1_500_000, provider_currency: "NGN", amount_cents: 1000, currency: "USD", checkout_url: expect.stringContaining("checkout.paystack.com") });
  });

  it("a second tap reuses the open checkout — one intent, one checkout", async () => {
    await checkout();
    const again = await (await checkout()).json();
    expect(again).toMatchObject({ reused: true });
    expect(order).toHaveLength(1);
    expect(attempts()).toHaveLength(1);
  });

  it("7 · an UNKNOWN outcome (timeout) is held; the next tap does NOT open a second checkout while Paystack may have it", async () => {
    initAnswer = async () => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    };
    expect((await checkout()).status).toBe(503);
    expect(attempts()[0]).toMatchObject({ status: "verification_required" });
    verifyAnswer = (ref) => charge(ref, { status: "pending" });
    const res = await checkout();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "PAYMENT_CONFIRMING" });
    expect(order).toHaveLength(1);
  });

  it("a held attempt Paystack never created is released, and a new checkout may open", async () => {
    initAnswer = async () => {
      throw new PaystackHttpError("upstream", 502);
    };
    await checkout();
    verifyAnswer = () => {
      throw new PaystackHttpError("Transaction reference not found", 400);
    };
    initAnswer = async (o) => `https://checkout.paystack.com/${o.reference}`;
    expect((await checkout()).status).toBe(200);
    expect(attempts().map((a) => a.status).sort()).toEqual(["failed", "pending"]);
  });

  it("a definite refusal (4xx) closes the attempt as failed", async () => {
    initAnswer = async () => {
      throw new PaystackHttpError("Invalid plan", 400);
    };
    await checkout();
    expect(attempts()[0]).toMatchObject({ status: "failed" });
  });
});

describe("AI plan recovery — activated once, only on an exact verified charge", () => {
  it("10 · a paid checkout nobody came back from is activated by the sweep — ONCE, however often it runs", async () => {
    await checkout();
    const s1 = await sweep();
    expect(s1).toMatchObject({ settled: 1 });
    expect(db.tables.ai_subscriptions).toHaveLength(1);
    expect(db.tables.ai_subscriptions![0]).toMatchObject({ user_id: USER, plan: "ai_pro", status: "active", provider: "paystack" });
    expect(attempts()[0]).toMatchObject({ status: "success", charge_id: "77" });
    const s2 = await sweep();
    expect(s2.examined).toBe(0);
    expect(db.tables.ai_subscriptions).toHaveLength(1);
  });

  it("wrong amount, wrong currency, another member or another plan → no plan, held as a mismatch", async () => {
    for (const over of [{ amount: 1_499_999 }, { currency: "USD", amount: 1000 }, { metadata: { user_id: "other", purpose: "frenz_ai_plan", ai_plan: "ai_pro" } }, { metadata: { user_id: USER, purpose: "frenz_ai_plan", ai_plan: "ai_max" } }]) {
      db = fakeDb({ ai_topup_attempts: [], ai_subscriptions: [] });
      await checkout();
      verifyAnswer = (ref) => charge(ref, over);
      const s = await sweep();
      expect(s, JSON.stringify(over)).toMatchObject({ mismatched: 1, settled: 0 });
      expect(db.tables.ai_subscriptions).toHaveLength(0);
      expect(attempts()[0]!.status).toBe("mismatch");
    }
  });

  it("a failed charge grants nothing and is closed; a verify that times out leaves it open", async () => {
    await checkout();
    verifyAnswer = () => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    };
    expect(await sweep()).toMatchObject({ verificationFailed: 1 });
    expect(attempts()[0]!.status).toBe("pending");
    verifyAnswer = (ref) => charge(ref, { status: "failed" });
    expect(await sweep()).toMatchObject({ failed: 1 });
    expect(db.tables.ai_subscriptions).toHaveLength(0);
  });
});

describe("recurring renewals stay with Paystack's subscription events", () => {
  it("11 · the sweep touches only OUR first-charge references — a renewal's Paystack reference is never ours", () => {
    expect(isPlanReference("frenz_ai_plan_2b1c8f8e-1111-4111-8111-111111111111")).toBe(true);
    for (const r of ["T123456789", "re4lyvq3s3", "frenz_cr_topup_2b1c8f8e-1111-4111-8111-111111111111", "frenz_bachs_plan_1"]) expect(isPlanReference(r), r).toBe(false);
    const hook = readFileSync(join(process.cwd(), "app/api/paystack/webhook/route.ts"), "utf8");
    for (const e of ["subscription.create", "subscription.disable", "subscription.not_renew", "invoice.update", "invoice.payment_failed"]) expect(hook).toContain(`"${e}"`);
    expect(readFileSync(join(process.cwd(), "app/api/ai/subscriptions/checkout/route.ts"), "utf8")).toContain('usable: (p) => (p === "flutterwave" ? flutterwaveOk : p === "paystack" && paystackOk)');
  });
});
