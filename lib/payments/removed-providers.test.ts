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
  });

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
  it("only Paystack is a provider; a stored 'bachs' route or legacy switch reads as Paystack", () => {
    expect(TOPUP_PROVIDER_IDS).toEqual(["paystack"]);
    const w = normalizeAiWalletConfig({ provider: "bachs", routing: { NG: { wallet_topup: { primary: "bachs", fallback: "paystack" }, ai_subscription: { primary: "bachs", fallback: null }, ad_campaign: { primary: "bachs", fallback: "bachs" } } } });
    expect(w.provider).toBe("paystack");
    expect(JSON.stringify(w.routing)).not.toContain("bachs");
    for (const purpose of ["wallet_topup", "ai_subscription", "ad_campaign"] as const) {
      expect(routePayment({ purpose, market: "NG", routing: w.routing, usable: () => true, preferred: "bachs" })).toEqual(["paystack"]);
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

  it("the schema keeps 'bachs' valid for history: no migration narrows the provider checks", () => {
    const migrations = readdirSync(join(ROOT, "supabase", "migrations")).filter((f) => f >= "0259");
    for (const m of migrations) expect(read(`supabase/migrations/${m}`), m).not.toMatch(/provider_chk|payment_method in \(/);
  });
});
