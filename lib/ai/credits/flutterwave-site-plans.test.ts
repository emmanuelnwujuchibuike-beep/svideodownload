import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VerifiedCharge } from "@/lib/payments/charge";
import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Owner, 2026-10-23: "Pro and business should be Flutterwave too". The REAL /api/checkout and /api/billing/portal
 * routes, plan attempts, the Flutterwave site-plan lifecycle and getUserPlan over an in-memory database; every
 * Flutterwave and Paystack answer is scripted (no network).
 */

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
});

let db: FakeDb;
const calls: string[] = [];
let fwPlan: { id: string; amountMinor: number | null; currency: string; interval: string; active: boolean };
let fwCheckout: (o: { reference: string }) => Promise<string>;
let fwVerify: (ref: string) => VerifiedCharge;
let fwSubs: { id: string; status: string; plan: string; email: string; amount: number | null; tx?: string; renewalTxs?: string[] }[];

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: USER, email: "a@b.co" } } }) } }) }));
vi.mock("@/lib/ai/credits/plan-welcome", () => ({ welcomeAiPlan: async () => {}, welcomeSitePlan: async () => {} }));
vi.mock("@/lib/analytics/events", () => ({ trackEvent: () => {} }));
vi.mock("@/lib/monetization/promo", () => ({ isPromoActiveNow: async () => false }));
// Part 6: the /pricing price members are SHOWN — a Flutterwave plan is sold only at exactly this amount
let shown: { pro: string; business: string };
vi.mock("@/lib/monetization/pricing", () => ({ getPricing: async () => ({ pro: { name: "Pro", price: shown.pro, period: "/mo" }, business: { name: "Business", price: shown.business, period: "/mo" } }) }));
vi.mock("@/lib/landing/settings", async () => {
  const { normalizeAiWalletConfig } = await import("@/lib/ai/credits/wallet-config");
  return { getLandingSettings: async () => ({ frenzAiCurrency: "USD", frenzAiPlans: { enabled: true, wallet: normalizeAiWalletConfig(null), plans: {} } }) };
});
vi.mock("@/lib/paystack/paystack", async (orig) => ({
  ...(await orig<typeof import("@/lib/paystack/paystack")>()),
  paystackEnabled: async () => true,
  planCodeForPlan: async (p: string) => (p === "pro" ? "PLN_pro" : "PLN_biz"),
  initializeTransaction: async (o: { planCode: string; reference?: string }) => (calls.push(`paystack:init:${o.planCode}:${o.reference ?? "paystack-ref"}`), "https://checkout.paystack.com/x"),
  subscriptionManageLink: async () => "https://paystack.com/manage/x",
}));
vi.mock("@/lib/flutterwave/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/flutterwave/client")>()),
  readFlutterwavePlan: async (id: string) => (calls.push(`fw:plan:${id}`), fwPlan),
  createFlutterwaveCheckout: async (o: { reference: string; paymentPlan?: string; amountMinor: number; currency: string }) => (calls.push(`fw:checkout:${o.paymentPlan}:${o.amountMinor}:${o.currency}:${db.tables.ai_topup_attempts?.some((r) => r.reference === o.reference) ? "row-first" : "NO-ROW"}`), fwCheckout(o)),
  verifyFlutterwaveByReference: async (ref: string) => fwVerify(ref),
  findFlutterwaveSubscriptions: async (q: { email?: string; plan?: string; transactionId?: string }) =>
    fwSubs.filter((s) => (!q.transactionId || s.tx === q.transactionId || (s.renewalTxs ?? []).includes(q.transactionId)) && (!q.email || s.email === q.email) && (!q.plan || s.plan === q.plan)),
  cancelFlutterwaveSubscription: async (id: string) => {
    calls.push(`fw:cancel:${id}`);
    for (const s of fwSubs) if (s.id === id) s.status = "cancelled";
  },
}));

const USER = "11111111-1111-4111-8111-111111111111";
const ENV = { FLUTTERWAVE_SECRET_KEY: "FLWSECK_TEST-k", FLUTTERWAVE_SECRET_HASH: "h", FLUTTERWAVE_VERIFIED_CURRENCIES: "USD", FLUTTERWAVE_ENABLED_PURPOSES: "site_subscription", FLUTTERWAVE_AMOUNT_UNIT: "major", FLUTTERWAVE_PLAN_PRO: "501", FLUTTERWAVE_PLAN_BUSINESS: "502" };
const setEnv = (on: boolean) => {
  for (const [k, v] of Object.entries(ENV)) {
    if (on) process.env[k] = v;
    else delete process.env[k];
  }
};

const { POST: CHECKOUT } = await import("@/app/api/checkout/route");
const { POST: PORTAL } = await import("@/app/api/billing/portal/route");
const { reconcilePendingPlanAttempts } = await import("./plan-attempts");
const { handleFlutterwaveRenewal, handleFlutterwaveSubscriptionCancelled, expireFlutterwaveSitePlans } = await import("./flutterwave-plans");
const { getUserPlan, flutterwaveSitePlanCurrent } = await import("@/lib/monetization/plan");
const { getLandingSettings } = await import("@/lib/landing/settings");
const { scriptPlanBillingRpcs } = await import("@/lib/testing/plan-billing-model");
const { FlutterwaveHttpError } = await import("@/lib/flutterwave/client");

const checkout = (body: Record<string, unknown> = { plan: "pro" }) => CHECKOUT(new Request("https://frenzsave.com/api/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const portal = (body?: Record<string, unknown>) => PORTAL(new Request("https://frenzsave.com/api/billing/portal", { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
const attempts = () => (db.tables.ai_topup_attempts ?? []).filter((r) => r.purpose === "site_subscription");
const sub = () => (db.tables.subscriptions ?? [])[0];
const role = () => (db.tables.profiles ?? [])[0]?.role;
const config = async () => (await getLandingSettings()).frenzAiPlans as never;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const DAY = 86_400_000;
const fwCharge = (ref: string | null, over: Partial<VerifiedCharge> = {}): VerifiedCharge => ({ provider: "flutterwave", reference: ref, externalId: "901", status: "success", amountMinor: 900, currency: "USD", channel: "card", paidAt: new Date().toISOString(), reason: null, customerEmail: "a@b.co", ...over });
const fwRow = (over: Record<string, unknown> = {}) => ({ id: USER, user_id: USER, plan: "pro", status: "active", provider: "flutterwave", customer_ref: "a@b.co", subscription_ref: "55", plan_code: "501", contract_amount_minor: 900, contract_currency: "USD", contract_interval: "monthly", current_period_end: new Date(Date.now() + 10 * DAY).toISOString(), cancel_at_period_end: false, last_reference: null, ...over });

beforeEach(() => {
  db = fakeDb({ ai_topup_attempts: [], ai_subscriptions: [], subscriptions: [], profiles: [{ id: USER, role: "user" }], financial_audit_log: [], plan_renewals: [], plan_billing_reviews: [] });
  scriptPlanBillingRpcs(db);
  delete process.env.FLUTTERWAVE_RENEWAL_TX_LOOKUP;
  db.unique.ai_topup_attempts = [["reference"]];
  db.unique.subscriptions = [["user_id"]];
  calls.length = 0;
  fwPlan = { id: "501", amountMinor: 900, currency: "USD", interval: "monthly", active: true };
  shown = { pro: "$9.00", business: "$9.00" };
  fwCheckout = async (o) => `https://checkout.flutterwave.com/pay/${o.reference}`;
  fwVerify = (ref) => fwCharge(ref);
  // the subscription Flutterwave creates for the first charge (transaction 901), on the Pro plan 501
  fwSubs = [{ id: "55", status: "active", plan: "501", email: "a@b.co", amount: 9, tx: "901" }];
  setEnv(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("Pro / Business checkout — Flutterwave first, Paystack the backup", () => {
  it("Flutterwave usable: the USD payment plan at its own price, the attempt written FIRST; Paystack untouched", async () => {
    const res = await checkout();
    expect(await res.json()).toMatchObject({ provider: "flutterwave" });
    expect(calls).toEqual(["fw:plan:501", "fw:checkout:501:900:USD:row-first"]);
    expect(attempts()[0]).toMatchObject({ provider: "flutterwave", item_id: "pro", provider_amount: 900, provider_currency: "USD", reference: expect.stringMatching(/^frenz_site_fw_/) });
  });

  it("Business uses its own Flutterwave plan id", async () => {
    await checkout({ plan: "business" });
    expect(calls[0]).toBe("fw:plan:502");
  });

  it("Flutterwave switched off → Paystack, exactly as before (Paystack's reference, no attempt row)", async () => {
    setEnv(false);
    expect(await (await checkout()).json()).toMatchObject({ provider: "paystack" });
    expect(calls).toEqual(["paystack:init:PLN_pro:paystack-ref"]);
    expect(attempts()).toHaveLength(0);
  });

  it("the member picked bank transfer / USSD → Paystack", async () => {
    expect(await (await checkout({ plan: "pro", provider: "paystack" })).json()).toMatchObject({ provider: "paystack" });
    expect(calls.some((c) => c.startsWith("fw:checkout"))).toBe(false);
  });

  it("🔴 Part 6: a Flutterwave plan whose amount differs from the price members are SHOWN is never charged — Paystack's plan takes it", async () => {
    for (const price of ["$4.99", "$9.99", "₦2,500", "Free"]) {
      calls.length = 0;
      shown = { pro: price, business: price };
      expect(await (await checkout()).json(), price).toMatchObject({ provider: "paystack" });
      expect(calls.some((c) => c.startsWith("fw:checkout")), price).toBe(false);
    }
    expect(attempts()).toHaveLength(0);
  });

  it("Part 6: the shown price written without its symbol ('9.00', shown as $9.00) still matches", async () => {
    shown = { pro: "9.00", business: "9.00" };
    expect(await (await checkout()).json()).toMatchObject({ provider: "flutterwave" });
  });

  it("Part 6: a plan on another interval (yearly) is never sold as a monthly plan", async () => {
    fwPlan = { ...fwPlan, interval: "yearly" };
    expect(await (await checkout()).json()).toMatchObject({ provider: "paystack" });
  });

  it("a plan that isn't USD, isn't active, or has no fixed amount is never sold on Flutterwave", async () => {
    for (const bad of [{ currency: "NGN" }, { active: false }, { amountMinor: null }]) {
      calls.length = 0;
      fwPlan = { id: "501", amountMinor: 900, currency: "USD", interval: "monthly", active: true, ...bad };
      expect(await (await checkout()).json()).toMatchObject({ provider: "paystack" });
      expect(calls.some((c) => c.startsWith("fw:checkout"))).toBe(false);
    }
  });

  it("Flutterwave DEFINITELY refused → attempt closed, Paystack opens", async () => {
    fwCheckout = async () => {
      throw new FlutterwaveHttpError("bad plan", 400);
    };
    expect(await (await checkout()).json()).toMatchObject({ provider: "paystack" });
    expect(attempts()[0]!.status).not.toBe("pending");
  });

  it("an UNKNOWN Flutterwave outcome is held — never sent to Paystack (no double subscription)", async () => {
    fwCheckout = async () => {
      throw new Error("timeout");
    };
    const res = await checkout();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "PAYMENT_CONFIRMING" });
    expect(calls.some((c) => c.startsWith("paystack:"))).toBe(false);
  });

  it("a member already on Pro has nothing to buy", async () => {
    db.tables.subscriptions!.push(fwRow());
    expect((await checkout()).status).toBe(409);
    expect(calls).toEqual([]);
  });
});

describe("activation — verified exactly, once", () => {
  it("the cron settles a paid attempt: Pro on Flutterwave for one interval, role pro; a second run changes nothing", async () => {
    await checkout();
    attempts()[0]!.created_at = ago(10 * 60_000);
    attempts()[0]!.updated_at = ago(10 * 60_000);
    expect(await reconcilePendingPlanAttempts(await config())).toMatchObject({ settled: 1 });
    expect(sub()).toMatchObject({ plan: "pro", status: "active", provider: "flutterwave", customer_ref: "a@b.co", cancel_at_period_end: false });
    expect(Date.parse(String(sub()!.current_period_end)) - Date.now()).toBeGreaterThan(27 * DAY);
    expect(role()).toBe("pro");
    const end = sub()!.current_period_end;
    expect(await reconcilePendingPlanAttempts(await config())).toMatchObject({ examined: 0 });
    expect(sub()!.current_period_end).toBe(end);
  });

  it("an underpaid first charge activates nothing", async () => {
    await checkout();
    attempts()[0]!.created_at = ago(10 * 60_000);
    attempts()[0]!.updated_at = ago(10 * 60_000);
    fwVerify = (ref) => fwCharge(ref, { amountMinor: 899 });
    expect(await reconcilePendingPlanAttempts(await config())).toMatchObject({ mismatched: 1 });
    expect(sub()).toBeUndefined();
    expect(role()).toBe("user");
  });
});

describe("renewals, cancellation and expiry (Part 3.3)", () => {
  it("activation stored the PROVEN subscription and the contract", async () => {
    await checkout();
    attempts()[0]!.created_at = ago(10 * 60_000);
    attempts()[0]!.updated_at = ago(10 * 60_000);
    await reconcilePendingPlanAttempts(await config());
    expect(sub()).toMatchObject({ subscription_ref: "55", plan_code: "501", contract_amount_minor: 900, contract_currency: "USD", contract_interval: "monthly" });
  });

  it("by default a subscriber's charge is held for review — no time added; proven ones are extended once", async () => {
    db.tables.subscriptions!.push(fwRow({ current_period_end: new Date(Date.now() + DAY).toISOString() }));
    const before = Date.parse(String(sub()!.current_period_end));
    expect(await handleFlutterwaveRenewal(fwCharge("Links-1", { externalId: "777" }))).toMatchObject({ outcome: "renewal:review" });
    expect(Date.parse(String(sub()!.current_period_end))).toBe(before);

    process.env.FLUTTERWAVE_RENEWAL_TX_LOOKUP = "confirmed";
    fwSubs[0]!.renewalTxs = ["778"];
    expect(await handleFlutterwaveRenewal(fwCharge("Links-1", { externalId: "778" }))).toMatchObject({ outcome: "renewal:applied" });
    const after = Date.parse(String(sub()!.current_period_end));
    expect(after - before).toBeGreaterThan(27 * DAY);
    expect(await handleFlutterwaveRenewal(fwCharge("Links-1", { externalId: "778" }))).toMatchObject({ outcome: "renewal:duplicate" });
    expect(Date.parse(String(sub()!.current_period_end))).toBe(after);
    expect(role()).toBe("pro");
  });

  it("H3 — subscription.cancelled (the documented object payload), confirmed: Pro STAYS until the paid-through time, then the sweep ends it", async () => {
    db.tables.subscriptions!.push(fwRow());
    db.tables.profiles![0]!.role = "pro";
    fwSubs[0]!.status = "cancelled";
    const payload = { status: "deactivated", currency: "USD", amount: 9, customer: { email: "a@b.co", full_name: "Anonymous customer" }, plan: { id: 501, name: "Pro", amount: 9, currency: "USD", interval: "monthly", duration: 0, status: "cancel", date_created: "2026-10-01" } };
    expect(await handleFlutterwaveSubscriptionCancelled(payload)).toMatchObject({ outcome: "cancel:confirmed" });
    expect(sub()).toMatchObject({ status: "active", cancel_at_period_end: true });
    expect(role()).toBe("pro");
    expect(await getUserPlan(USER)).toBe("pro");
    expect(await expireFlutterwaveSitePlans()).toEqual({ expired: 0, errors: 0 });
    // the paid period ends: no renewal grace after a cancellation
    sub()!.current_period_end = ago(60_000);
    expect(await getUserPlan(USER)).toBe("free");
    expect(await expireFlutterwaveSitePlans()).toEqual({ expired: 1, errors: 0 });
    expect(sub()!.status).toBe("canceled");
    expect(role()).toBe("user");
  });

  it("subscription.cancelled for a plan the member does not hold here → a review; nothing changes", async () => {
    db.tables.subscriptions!.push(fwRow());
    expect(await handleFlutterwaveSubscriptionCancelled({ customer: { email: "a@b.co" }, plan: { id: 502 } })).toMatchObject({ outcome: "cancel:review" });
    expect(sub()!.cancel_at_period_end).toBe(false);
  });

  it("the member's own cancel: ask first, then cancelled by the stored id and CONFIRMED; access stays to the period end", async () => {
    db.tables.subscriptions!.push(fwRow());
    expect(await (await portal()).json()).toMatchObject({ flutterwave: true, cancelled: false });
    expect(calls).toEqual([]);
    expect(await (await portal({ action: "cancel" })).json()).toMatchObject({ ok: true });
    expect(calls).toEqual(["fw:cancel:55"]);
    expect(sub()).toMatchObject({ status: "active", cancel_at_period_end: true });
    expect(await getUserPlan(USER)).toBe("pro");
  });

  it("a Paystack member still gets Paystack's manage link", async () => {
    db.tables.subscriptions!.push(fwRow({ provider: "paystack", subscription_ref: "SUB_x" }));
    expect(await (await portal()).json()).toEqual({ url: "https://paystack.com/manage/x" });
  });

  it("expiry: past the period + grace with no renewal → past due, role user; inside the grace, a Paystack row and an admin are left alone", async () => {
    db.tables.subscriptions!.push(fwRow({ current_period_end: ago(4 * DAY) }));
    db.tables.profiles![0]!.role = "pro";
    expect(await expireFlutterwaveSitePlans()).toEqual({ expired: 1, errors: 0 });
    expect(sub()!.status).toBe("past_due");
    expect(role()).toBe("user");

    db = fakeDb({ subscriptions: [fwRow({ current_period_end: ago(2 * DAY) }), { ...fwRow({ current_period_end: ago(30 * DAY), provider: "paystack" }), id: "p", user_id: "p" }], profiles: [{ id: USER, role: "admin" }] });
    scriptPlanBillingRpcs(db);
    expect(await expireFlutterwaveSitePlans()).toEqual({ expired: 0, errors: 0 });
    db.tables.subscriptions![0]!.current_period_end = ago(5 * DAY);
    expect(await expireFlutterwaveSitePlans()).toEqual({ expired: 1, errors: 0 });
    expect(role()).toBe("admin");
    expect(db.tables.subscriptions![1]!.status).toBe("active");
  });

  it("M3 — the sweep read the row as expired, a renewal landed, THEN the sweep wrote: the renewed member stays Pro", async () => {
    process.env.FLUTTERWAVE_RENEWAL_TX_LOOKUP = "confirmed";
    db.tables.subscriptions!.push(fwRow({ current_period_end: ago(5 * DAY) }));
    db.tables.profiles![0]!.role = "pro";
    fwSubs[0]!.renewalTxs = ["779"];
    // 1. the sweep's query sees it expired …
    const original = db.rpc.expire_flutterwave_site_plan!;
    db.rpc.expire_flutterwave_site_plan = async (a) => {
      // 2. … a verified renewal is applied between that query and the sweep's write …
      await handleFlutterwaveRenewal(fwCharge("Links-1", { externalId: "779" }));
      // 3. … and the write re-checks the period (the function's re-check under the row lock)
      return original(a);
    };
    expect(await expireFlutterwaveSitePlans()).toEqual({ expired: 0, errors: 0 });
    expect(sub()!.status).toBe("active");
    expect(role()).toBe("pro");
    expect(await getUserPlan(USER)).toBe("pro");
  });

  it("getUserPlan: a Flutterwave plan counts inside its paid period (+3 days only while a renewal may come); Paystack rows as before", async () => {
    expect(flutterwaveSitePlanCurrent({ provider: "flutterwave", current_period_end: ago(2 * DAY) })).toBe(true);
    expect(flutterwaveSitePlanCurrent({ provider: "flutterwave", current_period_end: ago(2 * DAY), cancel_at_period_end: true })).toBe(false);
    expect(flutterwaveSitePlanCurrent({ provider: "flutterwave", current_period_end: ago(4 * DAY) })).toBe(false);
    expect(flutterwaveSitePlanCurrent({ provider: "flutterwave", current_period_end: null })).toBe(false);
    expect(flutterwaveSitePlanCurrent({ provider: "paystack", current_period_end: ago(400 * DAY) })).toBe(true);
    db.tables.subscriptions!.push(fwRow({ current_period_end: ago(4 * DAY) }));
    expect(await getUserPlan(USER)).toBe("free");
  });
});

describe("upgrades stay on the rail that bills the current plan (Part 3.3, M2 — no orphaned subscription)", () => {
  it("a Paystack Pro member buying Business is sent to Paystack — never a second, Flutterwave subscription", async () => {
    db.tables.subscriptions!.push(fwRow({ provider: "paystack", subscription_ref: "SUB_x", plan_code: null }));
    expect(await (await checkout({ plan: "business" })).json()).toMatchObject({ provider: "paystack" });
    expect(calls.some((c) => c.startsWith("fw:"))).toBe(false);
  });

  it("a Flutterwave Pro member buying Business stays on Flutterwave, even when asking for Paystack", async () => {
    db.tables.subscriptions!.push(fwRow());
    expect(await (await checkout({ plan: "business", provider: "paystack" })).json()).toMatchObject({ provider: "flutterwave" });
    expect(calls.some((c) => c.startsWith("paystack:"))).toBe(false);
  });
});
