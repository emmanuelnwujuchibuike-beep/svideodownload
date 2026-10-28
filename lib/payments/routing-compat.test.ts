import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AI_WALLET_DEFAULTS, normalizeAiWalletConfig, normalizePaymentRouting, PAYMENT_PURPOSES, paymentRoutingProblem, ROUTING_VERSION } from "@/lib/ai/credits/wallet-config";
import { routePayment } from "@/lib/payments/router";

/**
 * Part 2.1 — saved routing tables and Flutterwave. A table saved before Flutterwave existed
 * (no routingVersion) could only say "Paystack"; it takes the new default on read. A version-2 table
 * is authoritative. Whatever any table says: Flutterwave is used only through its capability gate
 * (`usable`), Paystack always backs it, Bachs never appears, and subscriptions stay with Paystack.
 */

const both = () => true;
const paystackOnly = (p: string) => p === "paystack";
const PAYSTACK_ONLY_ROUTE = { primary: "paystack", fallback: null };
/** what the 2026-10-17 → Part 2 admin card saved (the normalized Paystack-only table, no version) */
const legacySaved = { NG: Object.fromEntries(["wallet_topup", "ai_subscription", "ad_campaign"].map((p) => [p, PAYSTACK_ONLY_ROUTE])), other: Object.fromEntries(["wallet_topup", "ai_subscription", "ad_campaign"].map((p) => [p, PAYSTACK_ONLY_ROUTE])) };

describe("fresh defaults", () => {
  it("owner 2026-10-27: Nigeria — Paystack first, Flutterwave the switch; everywhere else Flutterwave first, Paystack the backup; version 3", () => {
    const fresh = normalizeAiWalletConfig(null);
    expect(fresh.routingVersion).toBe(ROUTING_VERSION);
    expect(ROUTING_VERSION).toBe(3);
    for (const p of PAYMENT_PURPOSES) {
      expect(fresh.routing.NG[p]).toEqual({ primary: "paystack", fallback: "flutterwave" });
      expect(fresh.routing.other[p]).toEqual({ primary: "flutterwave", fallback: "paystack" });
    }
    expect(fresh.memberChoice).toBe(true);
  });
  it("a member in Nigeria who switches gets Flutterwave first — and one outside who switches gets Paystack first", () => {
    const { routing } = normalizeAiWalletConfig(null);
    for (const p of PAYMENT_PURPOSES) {
      expect(routePayment({ purpose: p, market: "NG", routing, usable: both })).toEqual(["paystack", "flutterwave"]);
      expect(routePayment({ purpose: p, market: "NG", routing, usable: both, preferred: "flutterwave" })).toEqual(["flutterwave", "paystack"]);
      expect(routePayment({ purpose: p, market: "other", routing, usable: both })).toEqual(["flutterwave", "paystack"]);
      expect(routePayment({ purpose: p, market: "other", routing, usable: both, preferred: "paystack" })).toEqual(["paystack", "flutterwave"]);
    }
  });
});

describe("a table saved before Flutterwave (version 1)", () => {
  it("its Paystack-only routes take the new default — they were never a choice against Flutterwave", () => {
    const w = normalizeAiWalletConfig({ routing: legacySaved });
    for (const p of PAYMENT_PURPOSES) expect(w.routing.NG[p]).toEqual({ primary: "paystack", fallback: "flutterwave" });
    for (const p of PAYMENT_PURPOSES) expect(w.routing.other[p]).toEqual({ primary: "flutterwave", fallback: "paystack" });
    expect(w.routingVersion).toBe(ROUTING_VERSION);
  });
  it("…but with Flutterwave's gate closed (the default today) the effective rail is STILL Paystack alone", () => {
    const w = normalizeAiWalletConfig({ routing: legacySaved });
    for (const p of PAYMENT_PURPOSES) expect(routePayment({ purpose: p, market: "NG", routing: w.routing, usable: paystackOnly })).toEqual(["paystack"]);
  });
  it("a Bachs-era route naming Bachs reads as the default — Bachs never selectable", () => {
    const w = normalizeAiWalletConfig({ routing: { NG: { wallet_topup: { primary: "bachs", fallback: "paystack" }, ad_campaign: { primary: "paystack", fallback: "bachs" } } } });
    expect(JSON.stringify(w.routing)).not.toContain("bachs");
    expect(routePayment({ purpose: "ad_campaign", market: "NG", routing: w.routing, usable: both, preferred: "bachs" })).not.toContain("bachs");
  });
});

describe("a version-2 table is authoritative", () => {
  it("an explicit Paystack-only route saved under version 2 stays Paystack-only", () => {
    const w = normalizeAiWalletConfig({ routingVersion: 2, routing: { NG: { wallet_topup: PAYSTACK_ONLY_ROUTE } } });
    expect(w.routing.NG.wallet_topup).toEqual(PAYSTACK_ONLY_ROUTE);
    expect(routePayment({ purpose: "wallet_topup", market: "NG", routing: w.routing, usable: both })).toEqual(["paystack"]);
  });
  it("Paystack-first with Flutterwave as the fallback is honoured as saved", () => {
    const w = normalizePaymentRouting({ NG: { wallet_topup: { primary: "paystack", fallback: "flutterwave" } } }, 2);
    expect(w.NG.wallet_topup).toEqual({ primary: "paystack", fallback: "flutterwave" });
  });
  it("🔴 'Flutterwave, no fallback' can never close payments: Paystack is always its backup", () => {
    for (const v of [1, 2, 3]) {
      const w = normalizePaymentRouting({ other: { wallet_topup: { primary: "flutterwave", fallback: null } } }, v);
      expect(w.other.wallet_topup).toEqual({ primary: "flutterwave", fallback: "paystack" });
      expect(routePayment({ purpose: "wallet_topup", market: "other", routing: w, usable: paystackOnly })).toEqual(["paystack"]);
    }
    const ng = normalizePaymentRouting({ NG: { wallet_topup: { primary: "flutterwave", fallback: null } } }, 3);
    expect(ng.NG.wallet_topup).toEqual({ primary: "flutterwave", fallback: "paystack" });
  });
  it("version 2 → 3: Nigeria's Flutterwave-first rows (the old default) read as Paystack first; other markets are untouched", () => {
    const old = { NG: { wallet_topup: { primary: "flutterwave", fallback: "paystack" }, sub_purchase: { primary: "flutterwave", fallback: "paystack" } }, other: { wallet_topup: { primary: "flutterwave", fallback: "paystack" } } };
    const w = normalizePaymentRouting(old, 2);
    expect(w.NG.wallet_topup).toEqual({ primary: "paystack", fallback: "flutterwave" });
    expect(w.NG.sub_purchase).toEqual({ primary: "paystack", fallback: "flutterwave" });
    expect(w.other.wallet_topup).toEqual({ primary: "flutterwave", fallback: "paystack" });
  });
  it("…but an admin who saves Flutterwave first for Nigeria under version 3 keeps it", () => {
    const w = normalizePaymentRouting({ NG: { wallet_topup: { primary: "flutterwave", fallback: "paystack" } } }, 3);
    expect(w.NG.wallet_topup).toEqual({ primary: "flutterwave", fallback: "paystack" });
    const cfg = normalizeAiWalletConfig({ routingVersion: 3, routing: { NG: { wallet_topup: { primary: "flutterwave", fallback: "paystack" } } } });
    expect(normalizeAiWalletConfig(cfg).routing.NG.wallet_topup).toEqual({ primary: "flutterwave", fallback: "paystack" });
  });
  it("re-reading a normalized table changes nothing (idempotent)", () => {
    const once = normalizeAiWalletConfig({ routing: legacySaved });
    const twice = normalizeAiWalletConfig(once);
    expect(twice.routing).toEqual(once.routing);
  });
});

describe("the capability gate decides, never the table", () => {
  it("per purpose: the gate open for wallet top-ups only routes only top-ups to Flutterwave", () => {
    const routing = AI_WALLET_DEFAULTS.routing;
    const gate = (purpose: string) => (p: string) => p === "paystack" || purpose === "wallet_topup";
    expect(routePayment({ purpose: "wallet_topup", market: "other", routing, usable: gate("wallet_topup") })).toEqual(["flutterwave", "paystack"]);
    expect(routePayment({ purpose: "ad_campaign", market: "other", routing, usable: gate("ad_campaign") })).toEqual(["paystack"]);
    expect(routePayment({ purpose: "wallet_topup", market: "NG", routing, usable: gate("wallet_topup") })).toEqual(["paystack", "flutterwave"]);
    expect(routePayment({ purpose: "ad_campaign", market: "NG", routing, usable: gate("ad_campaign"), preferred: "flutterwave" })).toEqual(["paystack"]);
  });
  it("AI plans (2026-10-23): Flutterwave only through its gate AND a plan id, Paystack the backup — the table never decides alone", () => {
    const src = readFileSync(join(process.cwd(), "app/api/ai/subscriptions/checkout/route.ts"), "utf8");
    expect(src).toContain('usable: (p) => (p === "flutterwave" ? flutterwaveOk : p === "paystack" && paystackOk)');
    expect(src).toContain('const flutterwaveOk = sameRail !== "paystack" && flutterwaveUsableFor("ai_subscription", await getFlutterwaveConfig()) && !!plan.flutterwavePlanId;');
    // Part 3.3: an upgrade stays on the rail billing the current plan (neither provider can cancel the other's subscription)
    expect(src).toContain('const paystackOk = sameRail !== "flutterwave" && (await paystackEnabled()) && !!plan.paystackPlanCode;');
    const site = readFileSync(join(process.cwd(), "app/api/checkout/route.ts"), "utf8");
    expect(site).toContain('const flutterwaveOk = sameRail !== "paystack" && flutterwaveUsableFor("site_subscription", fw) && !!fwPlanId;');
    expect(site).toContain('const paystackPlanCode = sameRail !== "flutterwave" && (await paystackEnabled()) ? await planCodeForPlan(planId) : null;');
  });
  it("the admin save accepts the table it is shown (Flutterwave, the new purposes, the version) — it used to reject it", () => {
    const route = readFileSync(join(process.cwd(), "app/api/admin/landing/route.ts"), "utf8");
    expect(route).toContain('primary: z.enum(["flutterwave", "paystack"])');
    expect(route).toContain("z.enum(PAYMENT_PURPOSES as unknown as [PaymentPurpose, ...PaymentPurpose[]])");
    expect(route).toContain("routingVersion: z.number().int().min(1).max(10).optional()");
    expect(readFileSync(join(process.cwd(), "features/admin/ai-plans-settings.tsx"), "utf8")).toContain("routingVersion: cfg.wallet.routingVersion,");
  });
});

describe("Part 5 — what an admin may SAVE (paymentRoutingProblem, run by the server before writing)", () => {
  it("the defaults and every safe choice pass", () => {
    expect(paymentRoutingProblem(AI_WALLET_DEFAULTS.routing)).toBeNull();
    expect(paymentRoutingProblem(undefined)).toBeNull();
    for (const route of [{ primary: "flutterwave", fallback: "paystack" }, { primary: "paystack", fallback: null }, { primary: "paystack", fallback: "flutterwave" }]) {
      expect(paymentRoutingProblem({ NG: { wallet_topup: route }, other: { sub_purchase: route } }), JSON.stringify(route)).toBeNull();
    }
  });
  it("refuses Flutterwave without Paystack behind it, a self-backup, unknown markets, purposes and providers", () => {
    expect(paymentRoutingProblem({ NG: { wallet_topup: { primary: "flutterwave", fallback: null } } })).toMatch(/Paystack as its backup/);
    expect(paymentRoutingProblem({ NG: { wallet_topup: { primary: "paystack", fallback: "paystack" } } })).toMatch(/same provider/);
    expect(paymentRoutingProblem({ GB: { wallet_topup: { primary: "paystack", fallback: null } } })).toMatch(/Unknown market/);
    expect(paymentRoutingProblem({ NG: { donation: { primary: "paystack", fallback: null } } })).toMatch(/Unknown payment purpose/);
    expect(paymentRoutingProblem({ NG: { wallet_topup: { primary: "stripe", fallback: null } } })).toMatch(/choose Flutterwave or Paystack/);
    expect(paymentRoutingProblem({ NG: { wallet_topup: { primary: "paystack", fallback: "bachs" } } })).toMatch(/unknown backup/);
    expect(paymentRoutingProblem("nope")).toMatch(/table of markets/);
  });
  it("every purpose the router knows can be routed (the editor offers them all)", () => {
    const all = Object.fromEntries(PAYMENT_PURPOSES.map((p) => [p, { primary: "flutterwave", fallback: "paystack" }]));
    expect(paymentRoutingProblem({ NG: all, other: all })).toBeNull();
  });
});
