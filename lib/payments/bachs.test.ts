import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isBachsProductId, normalizeAiPlansConfig } from "@/lib/ai/credits/config";
import { normalizeAiWalletConfig, normalizePaymentRouting } from "@/lib/ai/credits/wallet-config";
import { bachsBaseUrl, bachsStatusIsPaid, bachsSubscriptionStatus, decimalToMinor, usdCentsToDecimal, verifyBachsSignature } from "@/lib/payments/bachs";
import { paymentMarket, routePayment } from "@/lib/payments/router";

/**
 * Bachs (bachs.io) beside Paystack — owner 2026-10-07. The pieces that
 * decide whether money is real: the webhook signature, the amount format,
 * the routing, and the source order of the webhook and the fallback.
 */
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const SECRET = "whsec_test";
const sign = (body: string, t: number, secret = SECRET) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;

describe("🔴 the webhook signature (X-Bachs-Signature-V2)", () => {
  const body = JSON.stringify({ id: "evt_1", type: "collection.succeeded", data: { reference: "frenz_bachs_topup_x" } });
  const now = 1_800_000_000_000;
  const t = Math.floor(now / 1000);
  it("a genuine signature passes", () => {
    expect(verifyBachsSignature(body, sign(body, t), SECRET, now)).toEqual({ ok: true });
  });
  it("teeth: a tampered body, a wrong secret, a stale or missing header all fail", () => {
    expect(verifyBachsSignature(body.replace("topup_x", "topup_y"), sign(body, t), SECRET, now)).toMatchObject({ ok: false, reason: "mismatch" });
    expect(verifyBachsSignature(body, sign(body, t, "other"), SECRET, now)).toMatchObject({ ok: false, reason: "mismatch" });
    expect(verifyBachsSignature(body, sign(body, t - 301), SECRET, now)).toMatchObject({ ok: false, reason: "stale" });
    expect(verifyBachsSignature(body, null, SECRET, now)).toMatchObject({ ok: false, reason: "missing" });
    expect(verifyBachsSignature(body, sign(body, t), "", now)).toMatchObject({ ok: false, reason: "missing" });
    expect(verifyBachsSignature(body, "v1=abc", SECRET, now)).toMatchObject({ ok: false, reason: "malformed" });
  });
  it("during a secret rotation any v1 that matches passes", () => {
    const good = sign(body, t).split(",")[1];
    expect(verifyBachsSignature(body, `t=${t},v1=deadbeef,${good}`, SECRET, now)).toEqual({ ok: true });
  });
});

describe("money as Bachs writes it (a decimal string)", () => {
  it("USD cents ⇄ decimal, integers in and out", () => {
    expect(usdCentsToDecimal(1000)).toBe("10.00");
    expect(usdCentsToDecimal(5)).toBe("0.05");
    expect(decimalToMinor("75000.00")).toBe(7_500_000);
    expect(decimalToMinor("10.5")).toBe(1050);
    expect(decimalToMinor("1e3")).toBeNull();
    expect(decimalToMinor("-5.00")).toBeNull();
  });
  it("only SUCCEEDED is paid; unknown subscription statuses are not active", () => {
    expect(bachsStatusIsPaid("SUCCEEDED")).toBe(true);
    expect(bachsStatusIsPaid("open")).toBe(false);
    expect(bachsSubscriptionStatus("active")).toBe("active");
    expect(bachsSubscriptionStatus("past_due")).toBe("past_due");
    expect(bachsSubscriptionStatus("weird")).toBeNull();
  });
  it("the key's prefix picks the host", () => {
    expect(bachsBaseUrl("sk_live_x")).toBe("https://api.bachs.io");
    expect(bachsBaseUrl("sk_sandbox_x")).toBe("https://sandbox-api.bachs.io");
  });
});

describe("🔴 the router — the server picks the rail, never the browser", () => {
  const routing = normalizePaymentRouting(null);
  it("defaults: Nigeria → Bachs then Paystack; elsewhere → Paystack", () => {
    expect(routePayment({ purpose: "wallet_topup", market: "NG", routing, usable: () => true })).toEqual(["bachs", "paystack"]);
    expect(routePayment({ purpose: "ai_subscription", market: "other", routing, usable: () => true })).toEqual(["paystack"]);
  });
  it("an unconfigured rail is skipped (Bachs without its keys → Paystack)", () => {
    expect(routePayment({ purpose: "wallet_topup", market: "NG", routing, usable: (p) => p !== "bachs" })).toEqual(["paystack"]);
    expect(routePayment({ purpose: "wallet_topup", market: "NG", routing, usable: () => false })).toEqual([]);
  });
  it("teeth: the market comes from the edge only — a client-set x-country is ignored", () => {
    expect(paymentMarket(new Headers({ "cf-ipcountry": "NG" }))).toBe("NG");
    expect(paymentMarket(new Headers({ "x-vercel-ip-country": "NG" }))).toBe("NG");
    expect(paymentMarket(new Headers({ "x-country": "NG" }))).toBe("other");
    expect(paymentMarket(new Headers({ "cf-ipcountry": "GH", "x-country": "NG" }))).toBe("other");
  });
  it("normalises an admin's table: a fallback equal to the primary is no fallback; junk keeps the default", () => {
    const r = normalizePaymentRouting({ NG: { wallet_topup: { primary: "paystack", fallback: "paystack" } }, other: { ai_subscription: { primary: "stripe" } } });
    expect(r.NG.wallet_topup).toEqual({ primary: "paystack", fallback: null });
    expect(r.other.ai_subscription).toEqual({ primary: "paystack", fallback: null });
    expect(normalizeAiWalletConfig(undefined).routing.NG.ai_subscription.primary).toBe("bachs");
  });
  it("a Bachs product id is prod_…; a payment link is dropped", () => {
    expect(isBachsProductId("prod_abc123")).toBe(true);
    expect(isBachsProductId("https://checkout.bachs.io/c/V8xQ")).toBe(false);
    expect(normalizeAiPlansConfig({ plans: { ai_pro: { bachsProductId: "https://pay.bachs.io/x" } } }).plans.ai_pro.bachsProductId).toBe("");
  });
});

describe("🔴 the source order that keeps a payment single and verified", () => {
  it("the webhook verifies BEFORE it parses, logs the delivery BEFORE it acts, and acts only on our own reference", () => {
    const w = code("app/api/bachs/webhook/route.ts");
    expect(w.indexOf("verifyBachsSignature(raw")).toBeLessThan(w.indexOf("JSON.parse(raw)"));
    expect(w.indexOf("claimProviderEvent(")).toBeLessThan(w.indexOf("await handle("));
    expect(w).toContain('if (claim === "done")');
    expect(w).toContain("readBachsAttempt(reference)");
  });
  it("a Bachs checkout is opened only after its attempt row exists — no row, no checkout", () => {
    for (const f of ["lib/ai/wallet/bachs-topup.ts", "lib/ai/credits/bachs-plans.ts"]) {
      const s = code(f);
      expect(s.indexOf('.from("ai_topup_attempts").insert(')).toBeGreaterThan(-1);
      expect(s.indexOf('.from("ai_topup_attempts").insert(')).toBeLessThan(s.search(/createBachs(Subscription)?Checkout\(\{/));
    }
  });
  it("credits come from the attempt row's price, never from the event's metadata", () => {
    const s = code("lib/ai/wallet/bachs-topup.ts");
    expect(s).toContain("amountCents: Number(attempt.amount_cents)");
    expect(s).not.toMatch(/metadata\??\.credits/);
  });
  it("the fallback is tried only when the previous rail returned no checkout", () => {
    const t = code("lib/ai/character-replace/topup-server.ts");
    expect(t).toMatch(/if \(started\.ok\) \{[\s\S]*?return \{ ok: true, url: started\.url/);
    expect(t).toContain("last = started;\n      continue;");
  });
  it("secrets never reach a browser bundle", () => {
    for (const f of ["lib/payments/bachs.ts", "lib/ai/wallet/bachs-topup.ts", "lib/ai/credits/bachs-plans.ts"]) expect(code(f)).toContain('import "server-only";');
    expect(code("lib/payments/bachs.ts")).not.toContain("NEXT_PUBLIC_BACHS");
  });
});
