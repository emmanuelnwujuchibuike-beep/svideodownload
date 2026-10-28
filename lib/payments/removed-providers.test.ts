import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { normalizeAiWalletConfig, TOPUP_PROVIDER_IDS } from "@/lib/ai/credits/wallet-config";
import { routePayment } from "@/lib/payments/router";

import { isRemovedProviderReference } from "./removed-providers";

/**
 * Bachs (bachs.io) was REMOVED on 2026-10-17 (owner). No code path may start, verify, settle or
 * refund a Bachs payment; its historical rows are kept and never touched by code; a saved setting
 * can't bring it back. docs/PAYMENTS.md → "Bachs removed".
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
function sources(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (n === "node_modules" || n.startsWith(".")) continue;
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.ts$/.test(n)) out.push(p);
  }
  return out;
}

describe("Bachs is gone from the code", () => {
  it("no Bachs route exists: the webhook, the admin product check, the Bachs plan cancel", () => {
    for (const r of ["app/api/bachs/webhook/route.ts", "app/api/admin/ai/plans/verify-bachs/route.ts", "app/api/ai/subscriptions/cancel/route.ts"]) expect(existsSync(join(ROOT, r)), r).toBe(false);
    for (const m of ["lib/payments/bachs.ts", "lib/ai/wallet/bachs-topup.ts", "lib/ai/credits/bachs-plans.ts"]) expect(existsSync(join(ROOT, m)), m).toBe(false);
  });

  /** what would mean a Bachs integration is back in a source file */
  const integration = (src: string) => /@\/lib\/payments\/bachs\b|bachs-topup|bachs-plans|BACHS_(SECRET_KEY|WEBHOOK_SECRET|API_BASE)|api\.bachs\.io|\/api\/bachs\//.test(src);

  it("no source file imports it, reads its keys or calls its API", () => {
    const offenders = ["app", "lib", "features", "components"].flatMap((d) => sources(join(ROOT, d))).filter((f) => integration(readFileSync(f, "utf8")));
    expect(offenders.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
    // reads every source file: ~5 s on a busy machine, so the default 5 s timeout made it flaky (2026-10-19)
  }, 30_000);

  it("teeth: each way back in is caught", () => {
    expect(integration(`import { createBachsCheckout } from "@/lib/payments/bachs";`)).toBe(true);
    expect(integration(`const k = process.env.BACHS_SECRET_KEY;`)).toBe(true);
    expect(integration(`fetch("https://api.bachs.io/v1/checkout-sessions")`)).toBe(true);
    expect(integration(`// a removed provider's reference (Bachs, 2026-10-17)`)).toBe(false);
  });

  it("the env template names no Bachs variable", () => {
    expect(read(".env.example")).not.toMatch(/BACHS_/);
  });
});

describe("a saved setting can't bring Bachs back", () => {
  it("the live providers are Flutterwave and Paystack (Part 2) — never Bachs; a stored 'bachs' route or legacy switch reads as the default route", () => {
    expect(TOPUP_PROVIDER_IDS).toEqual(["flutterwave", "paystack"]);
    expect(TOPUP_PROVIDER_IDS as readonly string[]).not.toContain("bachs");
    const w = normalizeAiWalletConfig({ provider: "bachs", routing: { NG: { wallet_topup: { primary: "bachs", fallback: "paystack" }, ai_subscription: { primary: "bachs", fallback: null }, ad_campaign: { primary: "bachs", fallback: "bachs" } } } });
    expect(w.provider).toBe("paystack");
    expect(JSON.stringify(w.routing)).not.toContain("bachs");
    for (const purpose of ["wallet_topup", "ai_subscription", "ad_campaign", "sub_purchase", "verification"] as const) {
      const all = routePayment({ purpose, market: "NG", routing: w.routing, usable: () => true, preferred: "bachs" });
      expect(all).toEqual(["paystack", "flutterwave"]); // Nigeria: Paystack first (owner, 2026-10-27)
      expect(all as string[]).not.toContain("bachs");
      // with Flutterwave unconfirmed, Paystack still takes the payment
      expect(routePayment({ purpose, market: "NG", routing: w.routing, usable: (p) => p === "paystack", preferred: "bachs" })).toEqual(["paystack"]);
    }
  });
});

describe("historical Bachs references are held, never sent down the Paystack path", () => {
  it("recognises every reference Bachs minted, and nothing else", () => {
    for (const r of ["frenz_bachs_topup_1", "frenz_bachs_plan_1", "frenz_bachs_ad_1"]) expect(isRemovedProviderReference(r), r).toBe(true);
    for (const r of ["frenz_ai_topup_1", "frenz_ad_1", "frenz_sub_1", "bachs"]) expect(isRemovedProviderReference(r), r).toBe(false);
  });

  it("both verify-on-return routes stop at it BEFORE any Paystack call, answering pending", () => {
    const topup = read("app/api/ai/balance/topup/verify/route.ts");
    const guard = topup.indexOf("if (isRemovedProviderReference(reference)) return NextResponse.json({ credited: false, pending: true });");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(topup.indexOf("verifyTransaction(reference)"));
    const plan = read("app/api/ai/subscriptions/verify/route.ts");
    const pg = plan.indexOf('if (isRemovedProviderReference(reference)) return NextResponse.json({ activated: false, status: "pending" });');
    expect(pg).toBeGreaterThan(-1);
    expect(pg).toBeLessThan(plan.indexOf("verifyTransaction(reference)"));
  });

  /**
   * Part 2 (0271) widens these checks for Flutterwave. What must never happen is a check that drops
   * 'bachs': the historical rows would become invalid. Every (re)definition of the three provider
   * checks in a migration from 0259 on must still allow 'bachs'.
   */
  const HISTORY_CHECKS = /add constraint (ai_topup_attempts_provider_chk|payment_provider_events_provider_chk|ad_campaigns_method_chk)\s+check\s*\(([^;]*)\)/gi;
  const narrowsHistory = (sql: string) => [...sql.matchAll(HISTORY_CHECKS)].filter((m) => !/'bachs'/.test(m[2]!)).map((m) => m[1]!);

  it("the schema keeps 'bachs' valid for history: a migration may widen the provider checks, never drop 'bachs'", () => {
    const migrations = readdirSync(join(ROOT, "supabase", "migrations")).filter((f) => f >= "0259");
    for (const m of migrations) expect(narrowsHistory(read(`supabase/migrations/${m}`)), m).toEqual([]);
    // 0271 really widens all three (the guard above is not vacuous)
    const m271 = read("supabase/migrations/0271_payment_provider_flutterwave.sql");
    expect([...m271.matchAll(HISTORY_CHECKS)].map((x) => x[1])).toEqual(["ai_topup_attempts_provider_chk", "payment_provider_events_provider_chk", "ad_campaigns_method_chk"]);
    for (const x of m271.matchAll(HISTORY_CHECKS)) expect(x[2]).toMatch(/'flutterwave'/);
  });

  it("teeth: a check that drops 'bachs' is caught; one that keeps it is not", () => {
    expect(narrowsHistory("alter table public.ai_topup_attempts add constraint ai_topup_attempts_provider_chk check (provider in ('paystack', 'flutterwave'));")).toEqual(["ai_topup_attempts_provider_chk"]);
    expect(narrowsHistory("alter table public.ad_campaigns add constraint ad_campaigns_method_chk check (payment_method is null or payment_method in ('credits', 'paystack'));")).toEqual(["ad_campaigns_method_chk"]);
    expect(narrowsHistory("alter table public.ai_topup_attempts add constraint ai_topup_attempts_provider_chk check (provider in ('paystack', 'flutterwave', 'bachs')) not valid;")).toEqual([]);
  });
});
