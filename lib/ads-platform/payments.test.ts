import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { AI_WALLET_DEFAULTS, normalizePaymentRouting, type TopupProviderId } from "@/lib/ai/credits/wallet-config";
import { bachsFailureIsDefinite } from "@/lib/payments/bachs";
import { routePayment } from "@/lib/payments/router";
import { paystackFailureIsDefinite } from "@/lib/paystack/paystack";

import { firstCheckout, paymentState, type PaymentStart } from "./payment-server";

/**
 * Part 3 — ads paid through the EXISTING Paystack + Bachs rails.
 *
 * The money state machine (begin, release, settle, reverse, reconciliation)
 * was EXECUTED against a real Postgres when 0197 was written: 41 checks
 * covering the brief's matrix (T1–T24), 118 with Parts 1–2, and mutants of
 * the amount check, the quote check and the checkout window each failed
 * them. Pinned here: the router, the fallback rule, error classification,
 * the webhook ordering and the contract of the SQL.
 */

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const M197 = src("supabase/migrations/0197_ad_platform_payments.sql");

describe("routing — the existing router, a new purpose", () => {
  const routing = normalizePaymentRouting(null);
  const both = () => true;

  it("T1/T4 default: Nigeria → Bachs then Paystack; elsewhere → Paystack", () => {
    expect(routePayment({ purpose: "ad_campaign", market: "NG", routing, usable: both })).toEqual(["bachs", "paystack"]);
    expect(routePayment({ purpose: "ad_campaign", market: "other", routing, usable: both })).toEqual(["paystack"]);
  });
  it("configurable, not hard-coded: an admin route wins", () => {
    const custom = normalizePaymentRouting({ NG: { ad_campaign: { primary: "paystack", fallback: null } } });
    expect(routePayment({ purpose: "ad_campaign", market: "NG", routing: custom, usable: both })).toEqual(["paystack"]);
  });
  it("a saved config from before 0197 gains the ads row with the defaults", () => {
    const old = { NG: { wallet_topup: { primary: "paystack", fallback: null } }, other: {} };
    expect(normalizePaymentRouting(old).NG.ad_campaign).toEqual(AI_WALLET_DEFAULTS.routing.NG.ad_campaign);
  });
  it("T20 a provider the route does not allow, or an unconfigured one, is ignored", () => {
    expect(routePayment({ purpose: "ad_campaign", market: "other", routing, usable: both, preferred: "bachs" })).toEqual(["paystack"]);
    expect(routePayment({ purpose: "ad_campaign", market: "NG", routing, usable: both, preferred: "stripe" })).toEqual(["bachs", "paystack"]);
    expect(routePayment({ purpose: "ad_campaign", market: "NG", routing, usable: (p) => p !== "bachs" })).toEqual(["paystack"]);
  });
});

describe("the fallback rule — only after a REFUSAL", () => {
  const run = async (answers: Partial<Record<TopupProviderId, PaymentStart>>) => {
    const tried: string[] = [];
    const r = await firstCheckout(["bachs", "paystack"], async (p) => {
      tried.push(p);
      return answers[p]!;
    });
    return { r, tried };
  };
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  it("T1 Bachs creates the checkout → Paystack is never touched", async () => {
    const { r, tried } = await run({ bachs: { kind: "redirect", url: "https://pay.bachs.io/x", reference: "a", provider: "bachs" } });
    expect(r.kind).toBe("redirect");
    expect(tried).toEqual(["bachs"]);
  });
  it("T2 Bachs refused BEFORE a session existed → Paystack", async () => {
    const { r, tried } = await run({
      bachs: { kind: "refused", code: "provider_refused", status: 502 },
      paystack: { kind: "redirect", url: "https://checkout.paystack.com/y", reference: "b", provider: "paystack" },
    });
    expect(tried).toEqual(["bachs", "paystack"]);
    expect(r).toMatchObject({ kind: "redirect", provider: "paystack" });
  });
  it("T3 Bachs outcome UNKNOWN → verifying, and Paystack is NOT tried", async () => {
    const { r, tried } = await run({ bachs: { kind: "verifying", reference: "frenz_bachs_ad_1" }, paystack: { kind: "redirect", url: "x", reference: "z", provider: "paystack" } });
    expect(tried).toEqual(["bachs"]);
    expect(r).toEqual({ kind: "verifying", reference: "frenz_bachs_ad_1" });
  });
  it("a business refusal (expired quote) never tries another rail", async () => {
    const { tried } = await run({ bachs: { kind: "refused", code: "quote_expired", status: 409 } });
    expect(tried).toEqual(["bachs"]);
  });
  it("everything refused → payment_not_started (nobody was charged)", async () => {
    const { r } = await run({ bachs: { kind: "refused", code: "provider_refused", status: 502 }, paystack: { kind: "refused", code: "provider_refused", status: 502 } });
    expect(r).toEqual({ kind: "refused", code: "payment_not_started", status: 502 });
    warn.mockClear();
  });
});

describe("what counts as a refusal (docs.bachs.io/guides/idempotency, Paystack's own message)", () => {
  const err = (m: string, name = "Error") => Object.assign(new Error(m), { name });
  it("Bachs: a 4xx is a refusal; 5xx, 408, 409 (in progress), 429, timeouts and network errors are UNKNOWN", () => {
    expect(bachsFailureIsDefinite(err("bachs POST /v1/checkout-sessions → 422: invalid amount"))).toBe(true);
    expect(bachsFailureIsDefinite(err("bachs POST /v1/checkout-sessions → 401: bad key"))).toBe(true);
    for (const m of ["→ 500: x", "→ 502: x", "→ 503: x", "→ 409: IDEMPOTENCY_IN_PROGRESS", "→ 408: x", "→ 429: x"]) expect(bachsFailureIsDefinite(err(`bachs POST /v1/checkout-sessions ${m}`)), m).toBe(false);
    expect(bachsFailureIsDefinite(err("The operation was aborted due to timeout", "TimeoutError"))).toBe(false);
    expect(bachsFailureIsDefinite(err("fetch failed", "TypeError"))).toBe(false);
    expect(bachsFailureIsDefinite("weird")).toBe(false);
  });
  it("Paystack: its own message is a refusal; a timeout, a network drop or a non-JSON 5xx page is UNKNOWN", () => {
    expect(paystackFailureIsDefinite(err("Duplicate Transaction Reference"))).toBe(true);
    expect(paystackFailureIsDefinite(err("aborted", "TimeoutError"))).toBe(false);
    expect(paystackFailureIsDefinite(err("aborted", "AbortError"))).toBe(false);
    expect(paystackFailureIsDefinite(err("fetch failed", "TypeError"))).toBe(false);
    expect(paystackFailureIsDefinite(err("Unexpected token <", "SyntaxError"))).toBe(false);
  });
  it("an uncertain Bachs write is recovered with the SAME key and the UNCHANGED stored body - never a new key", () => {
    const pay = src("lib/ads-platform/payment-server.ts");
    expect(pay).toContain('await db.from("ai_topup_attempts").update({ provider_request: body }).eq("reference", reference);');
    expect(pay).toContain("const checkout = await postBachsCheckout(a.provider_request, a.reference);");
    expect(pay.indexOf("update({ provider_request: body })")).toBeLessThan(pay.indexOf("const checkout = await postBachsCheckout(body, reference);"));
    expect(pay).toMatch(/BACHS_IDEMPOTENCY_WINDOW_MS = 23 \* 3600_000/);
  });
});

describe("the advertiser sees the server's truth", () => {
  it("never 'live' unless every campaign is active; a redirect alone is 'verifying'", () => {
    expect(paymentState("pending", ["payment_processing"])).toBe("verifying");
    expect(paymentState("success", ["paid"])).toBe("activating");
    expect(paymentState("success", ["active", "paid"])).toBe("activating");
    expect(paymentState("success", ["active", "active"])).toBe("live");
    expect(paymentState("success", ["validating"])).toBe("review");
    expect(paymentState("mismatch", ["payment_processing"])).toBe("review");
    expect(paymentState("verification_required", [])).toBe("verifying");
    expect(paymentState("failed", [])).toBe("failed");
    expect(paymentState("abandoned", [])).toBe("cancelled");
    expect(paymentState("chargeback", ["paused"])).toBe("chargeback");
  });
  it("the return page checks a handful of times on a widening backoff, then stops", () => {
    const page = src("features/ads-platform/payment-return.tsx");
    expect(page).toContain("const BACKOFF_MS = [0, 2_000, 4_000, 8_000, 15_000, 30_000];");
    expect(page).not.toMatch(/setInterval\(/);
    // "Payment verified" / "Campaign Live" only once the SERVER says so (§80.13–14)
    expect(page).toMatch(/case "paid":\s*case "activating":\s*return \{ title: "Payment verified"/);
    expect(page).toMatch(/case "live":\s*return \{ title: "Campaign Live"/);
    expect(page).toMatch(/const state = view\?\.state \?\? "verifying";/);
    // §69: leaving the page cancels the timer AND the request in flight
    expect(page).toContain("if (timer.current) clearTimeout(timer.current);");
    expect(page).toContain("inflight.current?.abort();");
    // a manual check can never stack on one already running
    expect(page).toContain("if (!reference || inflight.current) return null;");
    expect(page).toMatch(/disabled=\{checking\}/);
  });
  it("§58 an uncertain payment says 'do not pay again' rather than offering a fresh payment first", () => {
    const page = src("features/ads-platform/payment-return.tsx");
    expect(page).toContain('if (paymentStatus === "verification_required")');
    expect(page).toContain('"Payment could not be verified"');
    expect(page).toContain("You don't need to pay again yet.");
    // "Paid" is the server's word only: an unconfirmed payment is an "Amount"
    expect(page).toContain('const paid = view?.paymentStatus === "success";');
    expect(page).toContain('totalLabel={paid ? "Paid" : "Amount"}');
    expect(page).toContain('"Payment failed", body: "Your campaign was not activated. No campaign credit was applied."');
    expect(page).toContain('"Your payment session expired", body: "The campaign price or promotion may have changed."');
  });
  it("§59 an expired quote stops and asks for a review; a changed price is shown before it is paid", () => {
    const wiz = src("features/ads-platform/advertise-wizard.tsx");
    // the held price ran out: no silent re-quote
    expect(wiz).toMatch(/if \(quote && Date\.parse\(quote\.expiresAt\) <= Date\.now\(\) \+ 30_000\) \{\s*setLocked\(null\);\s*setSessionExpired\(true\);\s*return;/);
    // the server's price differs from the estimate on screen: show it, do not pay it on this tap
    expect(wiz).toMatch(/if \(quote\.total !== est\.total \|\| quote\.currency !== est\.currency\) \{\s*setPriceUpdated\(true\);\s*return;/);
    // the server refusing a stale quote lands on the same screen
    expect(wiz).toMatch(/r\.code === "quote_expired" \|\| r\.code === "quote_invalid" \|\| r\.code === "not_payable"\) \{\s*setLocked\(null\);\s*setSessionExpired\(true\);/);
    expect(wiz).toContain("Your payment session expired");
    expect(wiz).toContain("loadAdCatalog(Date.now(), { fresh: true })");
  });
  it("T19/T21 the browser sends a campaign and a quote - never an amount, currency, duration or status", () => {
    const wiz = src("features/ads-platform/advertise-wizard.tsx");
    expect(wiz).toContain('api<{ url?: string; verifying?: boolean; reference: string }>("/api/ads/payment/create", "POST", { campaignId: form.campaignId, quoteId: quote.quoteId });');
    const route = src("app/api/ads/payment/create/route.ts");
    expect(route).not.toMatch(/body\.(amount|price|total|currency|duration|status|promotion|days)/);
    expect(route).toContain("market: paymentMarket(request.headers)");
  });
  it("T18 the pay button is disabled from the first tap until the page leaves", () => {
    const wiz = src("features/ads-platform/advertise-wizard.tsx");
    expect(wiz).toContain("if (!form.campaignId || !rulesAccepted || busy || !est) return;");
    expect(wiz).toContain("return; // stays busy: the page is leaving");
    expect(wiz).toMatch(/onClick=\{\(\) => void pay\(\)\}\s*disabled=\{!rulesAccepted \|\| !!busy \|\| !est \|\| sessionExpired\}/);
    // §55: while it is disabled, the label says what is happening
    expect(wiz).toContain('"Preparing Payment…"');
    expect(wiz).toContain('"Opening Secure Checkout…"');
  });
});

describe("webhooks: the existing endpoints, an ad branch BEFORE every wallet line", () => {
  it("Bachs: an ad attempt settles campaigns and can never reach the wallet credit", () => {
    const w = src("app/api/bachs/webhook/route.ts");
    const adBranch = w.indexOf('if (attempt.purpose === "ad_campaign") return handleBachsAdCollection(');
    expect(adBranch).toBeGreaterThan(-1);
    expect(adBranch).toBeLessThan(w.indexOf("creditBachsTopup(attempt"));
    expect(adBranch).toBeLessThan(w.indexOf('if (attempt.purpose === "ai_subscription")'));
    expect(w.indexOf("verifyBachsSignature(raw")).toBeLessThan(w.indexOf("claimProviderEvent("));
    expect(w).toMatch(/type === "refund\.paid" \|\| type === "dispute\.created" \|\| type === "dispute\.updated"/);
  });
  it("Paystack: the ad branch comes after the signature and before the top-up and plan branches", () => {
    const w = src("app/api/paystack/webhook/route.ts");
    const sig = w.indexOf("verifyPaystackSignature(payload, sig)");
    const ad = w.indexOf("event.data?.metadata?.purpose === AD_CAMPAIGN_PURPOSE");
    expect(sig).toBeGreaterThan(-1);
    expect(ad).toBeGreaterThan(sig);
    expect(ad).toBeLessThan(w.indexOf("event.data?.metadata?.purpose === CHARACTER_REPLACE_TOPUP_PURPOSE"));
    expect(ad).toBeLessThan(w.indexOf("isAiPlanEvent("));
    expect(w).toContain('claimProviderEvent("paystack", key, event.event, ref)');
  });
  it("refunds and disputes are matched by the stored charge id (Bachs) or our reference prefix (Paystack) - nothing else is touched", () => {
    const pay = src("lib/ads-platform/payment-server.ts");
    expect(pay).toContain('.eq("provider", "bachs").eq("charge_id", chargeId).eq("purpose", "ad_campaign")');
    expect(pay).toMatch(/\[data\.transaction_reference, tx\?\.reference, data\.reference\]\.find\(\(v\): v is string => typeof v === "string" && v\.startsWith\(AD_PAYSTACK_PREFIX\)\)/);
  });
});

describe("0197 — the money state in the database", () => {
  const fn = (name: string) => {
    const s = M197.indexOf(`create or replace function public.${name}(`);
    expect(s, name).toBeGreaterThan(-1);
    return M197.slice(s, M197.indexOf("$$;", s));
  };
  it("no second payment table: ads extend ai_topup_attempts and reuse payment_provider_events", () => {
    expect(M197).not.toMatch(/create table if not exists public\.\w*payment(s|_attempts|_ledger)\b/);
    expect(M197).toContain("alter table public.ai_topup_attempts add column if not exists quote_id uuid;");
    expect(src("supabase/migrations/0195_ad_platform_foundation.sql")).toContain("check (purpose in ('wallet_topup', 'ai_subscription', 'ad_campaign'))");
  });
  it("T18/T37 one open checkout per application, one payment per provider charge", () => {
    expect(M197).toMatch(/create unique index if not exists ai_topup_attempts_ad_open_idx\s+on public\.ai_topup_attempts \(item_id\)\s+where purpose = 'ad_campaign' and status in \('pending', 'verification_required'\);/);
    expect(M197).toMatch(/create unique index if not exists ai_topup_attempts_charge_idx\s+on public\.ai_topup_attempts \(provider, charge_id\) where charge_id is not null;/);
    expect(M197).toContain("create unique index if not exists ad_payment_quotes_one_open_idx on public.ad_payment_quotes (application_id) where status = 'open';");
  });
  it("begin: the quote must be open, unexpired, in USD and equal to the campaigns' locked totals", () => {
    const b = fn("ad_payment_begin");
    expect(b).toContain("if v_q.expires_at <= now() then");
    expect(b).toContain("if v_q.currency <> 'USD' or v_q.total_minor <> p_amount_usd then");
    expect(b).toContain("if v_total <> v_q.total_minor then");
    expect(b).toContain("if not coalesce(v_settings.payments_enabled, false) then");
  });
  it("settle: locked, idempotent, amount + currency + provider + purpose + window checked, never short", () => {
    const s = fn("ad_payment_settle");
    expect(s).toContain("where reference = p_reference for update;");
    expect(s).toContain("if v_a.status = 'success' then");
    expect(s).toContain("if v_a.provider <> p_provider then");
    expect(s).toContain("if v_a.purpose <> 'ad_campaign' then");
    expect(s).toContain("p_paid_amount + 1 >= coalesce(v_a.provider_amount, v_a.amount_cents)");
    expect(s).toContain("'paid_after_checkout_window'");
  });
  it("reverse follows the admin's refund and chargeback policy; a partial refund leaves the campaign to the admin", () => {
    const r = fn("ad_payment_reverse");
    expect(r).toContain("when c.started_at is null then 'remove'");
    expect(r).toContain("when p_kind = 'chargeback' then v_s.chargeback_action");
    expect(r).toContain("else v_s.refund_after_start end;");
    expect(r).toContain("if v_partial then return jsonb_build_object('ok', true, 'status', v_status, 'campaigns', 'unchanged'); end if;");
  });
  it("Part 1's shortcuts are gone: no wallet-paid ads, one settle path", () => {
    expect(M197).toContain("drop function if exists public.settle_ad_campaign_payment(text);");
    expect(M197).toContain("drop function if exists public.pay_ad_campaign_with_credits(uuid, uuid);");
    expect(src("lib/ads-platform/server.ts")).not.toMatch(/pay_ad_campaign_with_credits|settle_ad_campaign_payment/);
  });
  it("every money function is server-only", () => {
    const grants = M197.slice(M197.lastIndexOf("foreach fn in array array["));
    for (const f of ["ad_payment_begin", "ad_payment_release", "ad_payment_settle", "ad_payment_reverse", "ad_payment_inconsistencies"]) expect(grants, f).toContain(`'public.${f}(`);
    expect(grants).not.toMatch(/to anon|to authenticated/);
  });
});
