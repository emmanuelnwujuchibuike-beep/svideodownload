import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { flutterwaveCheckoutGate, flutterwaveUsableFor, resolveFlutterwaveConfig } = await import("./config");
const { createFlutterwaveCheckout, FlutterwaveHttpError, FlutterwaveLocalRefusal, flutterwaveFailureIsDefinite, majorToMinor, mapFlutterwaveStatus, minorToMajor, toVerifiedCharge, verifyFlutterwaveById, verifyFlutterwaveByReference, verifyFlutterwaveWebhookWith } = await import("./client");
const { chargeMatches } = await import("@/lib/payments/charge");
const { firstRail } = await import("@/lib/payments/router");
const { flutterwaveReferencePurpose, newFlutterwaveReference } = await import("@/lib/payments/references");

/**
 * Part 2 (Flutterwave): the adapter, the account-capability gate, the charge matching and the
 * fallback rule. No network: every Flutterwave answer is a scripted `fetch`.
 */

const FULL = { FLUTTERWAVE_SECRET_KEY: "FLWSECK_TEST-abc", FLUTTERWAVE_SECRET_HASH: "hash-123", FLUTTERWAVE_VERIFIED_CURRENCIES: "USD", FLUTTERWAVE_ENABLED_PURPOSES: "wallet_topup,sub_purchase,verification,ad_campaign", FLUTTERWAVE_AMOUNT_UNIT: "major" };

describe("the capability gate — ON by default once the key and webhook hash exist (owner, 2026-10-24)", () => {
  it("no key: Flutterwave can't take any purpose (nothing can default a credential)", () => {
    for (const p of ["wallet_topup", "sub_purchase", "verification", "ad_campaign", "ai_subscription", "site_subscription"]) expect(flutterwaveUsableFor(p, resolveFlutterwaveConfig({}))).toBe(false);
  });
  it("a key without the webhook hash never opens a checkout (a webhook couldn't be told from a forgery)", () => {
    const key = resolveFlutterwaveConfig({ FLUTTERWAVE_SECRET_KEY: "FLWSECK-live" });
    expect(flutterwaveCheckoutGate("wallet_topup", "USD", key)).toEqual({ ok: false, reason: "webhook_secret_missing" });
  });
  it("🟢 key + hash and NOTHING else set: every purpose is open in USD — 'working immediately after push'", () => {
    const keyAndHash = resolveFlutterwaveConfig({ FLUTTERWAVE_SECRET_KEY: "FLWSECK-live", FLUTTERWAVE_SECRET_HASH: "h" });
    expect(keyAndHash).toMatchObject({ verifiedCurrencies: ["USD"], amountUnitConfirmed: true });
    for (const p of ["wallet_topup", "sub_purchase", "verification", "ad_campaign", "ai_subscription", "site_subscription"]) expect(flutterwaveCheckoutGate(p, "USD", keyAndHash), p).toEqual({ ok: true });
    // blank env vars mean the same as unset
    expect(flutterwaveUsableFor("wallet_topup", resolveFlutterwaveConfig({ FLUTTERWAVE_SECRET_KEY: "FLWSECK-live", FLUTTERWAVE_SECRET_HASH: "h", FLUTTERWAVE_VERIFIED_CURRENCIES: "", FLUTTERWAVE_ENABLED_PURPOSES: " ", FLUTTERWAVE_AMOUNT_UNIT: "" }))).toBe(true);
  });
  it("it can still be switched OFF: env 'none' / 'unconfirmed', or a saved dashboard list (even empty) wins", () => {
    const base = { FLUTTERWAVE_SECRET_KEY: "FLWSECK-live", FLUTTERWAVE_SECRET_HASH: "h" };
    expect(flutterwaveCheckoutGate("wallet_topup", "USD", resolveFlutterwaveConfig({ ...base, FLUTTERWAVE_ENABLED_PURPOSES: "none" }))).toEqual({ ok: false, reason: "purpose_disabled" });
    expect(flutterwaveCheckoutGate("wallet_topup", "USD", resolveFlutterwaveConfig({ ...base, FLUTTERWAVE_VERIFIED_CURRENCIES: "off" }))).toEqual({ ok: false, reason: "currency_not_verified" });
    expect(flutterwaveCheckoutGate("wallet_topup", "USD", resolveFlutterwaveConfig({ ...base, FLUTTERWAVE_AMOUNT_UNIT: "unconfirmed" }))).toEqual({ ok: false, reason: "amount_unit_unconfirmed" });
    expect(flutterwaveCheckoutGate("wallet_topup", "USD", resolveFlutterwaveConfig(base, { enabledPurposes: [] }))).toEqual({ ok: false, reason: "purpose_disabled" });
    expect(flutterwaveUsableFor("sub_purchase", resolveFlutterwaveConfig(base, { enabledPurposes: ["wallet_topup"] }))).toBe(false);
    // the dashboard's unticked boxes: an empty currency list and an explicit "unconfirmed" unit (blank would mean the ON default)
    expect(flutterwaveCheckoutGate("wallet_topup", "USD", resolveFlutterwaveConfig(base, { verifiedCurrencies: [] }))).toEqual({ ok: false, reason: "currency_not_verified" });
    expect(flutterwaveCheckoutGate("wallet_topup", "USD", resolveFlutterwaveConfig(base, { amountUnit: "unconfirmed" }))).toEqual({ ok: false, reason: "amount_unit_unconfirmed" });
  });
  it("a wrong amount unit is never accepted: anything but 'major' keeps it closed (a 100× mis-price)", () => {
    for (const unit of ["minor", "cents", "kobo"]) expect(flutterwaveUsableFor("wallet_topup", resolveFlutterwaveConfig({ ...FULL, FLUTTERWAVE_AMOUNT_UNIT: unit })), unit).toBe(false);
  });
  it("USD unconfirmed: Flutterwave is unusable even with NGN confirmed (it never charges another currency in place of USD)", () => {
    const ngnOnly = resolveFlutterwaveConfig({ ...FULL, FLUTTERWAVE_VERIFIED_CURRENCIES: "NGN" });
    expect(flutterwaveUsableFor("wallet_topup", ngnOnly)).toBe(false);
  });
  it("all confirmed: the switched-on purposes only", () => {
    const some = resolveFlutterwaveConfig({ ...FULL, FLUTTERWAVE_ENABLED_PURPOSES: "wallet_topup" });
    expect(flutterwaveUsableFor("wallet_topup", some)).toBe(true);
    expect(flutterwaveUsableFor("ad_campaign", some)).toBe(false);
  });
  it("AI plans and (owner: 'Pro and business should be Flutterwave too') Pro/Business site plans go to Flutterwave only when switched on", () => {
    const all = resolveFlutterwaveConfig({ ...FULL, FLUTTERWAVE_ENABLED_PURPOSES: "wallet_topup,ai_subscription,site_subscription" });
    expect(flutterwaveCheckoutGate("ai_subscription", "USD", all)).toEqual({ ok: true });
    expect(flutterwaveCheckoutGate("site_subscription", "USD", all)).toEqual({ ok: true });
    expect(flutterwaveCheckoutGate("ai_subscription", "USD", resolveFlutterwaveConfig(FULL))).toEqual({ ok: false, reason: "purpose_disabled" });
    expect(flutterwaveCheckoutGate("site_subscription", "USD", resolveFlutterwaveConfig(FULL))).toEqual({ ok: false, reason: "purpose_disabled" });
    // switched on but in naira: still closed (Flutterwave charges USD here)
    expect(flutterwaveCheckoutGate("site_subscription", "NGN", all)).toEqual({ ok: false, reason: "currency_not_verified" });
  });
  it("site plan ids: the dashboard's first, env the fallback, digits only", () => {
    expect(resolveFlutterwaveConfig({ FLUTTERWAVE_PLAN_PRO: "111", FLUTTERWAVE_PLAN_BUSINESS: "PLN_x" })).toMatchObject({ sitePlanPro: "111", sitePlanBusiness: "" });
    expect(resolveFlutterwaveConfig({ FLUTTERWAVE_PLAN_PRO: "111" }, { sitePlanPro: "222" }).sitePlanPro).toBe("222");
    expect(resolveFlutterwaveConfig({}, null)).toMatchObject({ sitePlanPro: "", sitePlanBusiness: "" });
  });
  it("test/live mode comes from the key prefix", () => {
    expect(resolveFlutterwaveConfig({ FLUTTERWAVE_SECRET_KEY: "FLWSECK_TEST-x" }).mode).toBe("test");
    expect(resolveFlutterwaveConfig({ FLUTTERWAVE_SECRET_KEY: "FLWSECK-x" }).mode).toBe("live");
  });
});

describe("webhook verif-hash", () => {
  const cfg = resolveFlutterwaveConfig(FULL);
  it("missing or wrong header → refused; the exact secret → accepted", () => {
    expect(verifyFlutterwaveWebhookWith(null, cfg)).toBe(false);
    expect(verifyFlutterwaveWebhookWith("", cfg)).toBe(false);
    expect(verifyFlutterwaveWebhookWith("hash-124", cfg)).toBe(false);
    expect(verifyFlutterwaveWebhookWith("hash-1234", cfg)).toBe(false);
    expect(verifyFlutterwaveWebhookWith("hash-123", cfg)).toBe(true);
  });
  it("no secret configured → every delivery refused (never 'anything goes')", () => {
    expect(verifyFlutterwaveWebhookWith("", resolveFlutterwaveConfig({}))).toBe(false);
    expect(verifyFlutterwaveWebhookWith("anything", resolveFlutterwaveConfig({ FLUTTERWAVE_SECRET_KEY: "k" }))).toBe(false);
  });
});

describe("amounts and statuses", () => {
  it("minor ↔ major units, two-decimal currencies only", () => {
    expect(minorToMajor(1050, "USD")).toBe(10.5);
    expect(majorToMinor(10.5, "USD")).toBe(1050);
    expect(majorToMinor("19.99", "USD")).toBe(1999);
    expect(majorToMinor(10, null)).toBeNull();
    // Part 2.1: exact decimal parsing — never float rounding into a match
    expect(majorToMinor(0.1 + 0.2, "USD")).toBeNull(); // 0.30000000000000004: not a real amount
    expect(majorToMinor("10.005", "USD")).toBeNull();
    expect(majorToMinor(10.005, "USD")).toBeNull();
    expect(majorToMinor("10.5", "USD")).toBe(1050);
    expect(majorToMinor("1e3", "USD")).toBeNull();
    expect(majorToMinor(-5, "USD")).toBeNull();
    expect(majorToMinor("", "USD")).toBeNull();
    expect(majorToMinor(1.1, "USD")).toBe(110);
    expect(majorToMinor(4.35, "USD")).toBe(435); // 4.35 * 100 = 434.99999999999994 in floats
    expect(() => minorToMajor(100, "XOF")).toThrow(FlutterwaveLocalRefusal);
    expect(() => minorToMajor(10.5, "USD")).toThrow(FlutterwaveLocalRefusal);
    expect(() => minorToMajor(0, "USD")).toThrow(FlutterwaveLocalRefusal);
  });
  it("Flutterwave's words map to ours; anything unknown is pending, never final", () => {
    expect(mapFlutterwaveStatus("successful")).toBe("success");
    expect(mapFlutterwaveStatus("failed")).toBe("failed");
    expect(mapFlutterwaveStatus("cancelled")).toBe("abandoned");
    expect(mapFlutterwaveStatus("pending")).toBe("pending");
    expect(mapFlutterwaveStatus("something-new")).toBe("pending");
  });
  it("a raw transaction becomes a VerifiedCharge with the provider's id kept apart from our reference", () => {
    expect(toVerifiedCharge({ id: 987, tx_ref: "frenz_x", status: "successful", amount: 10, currency: "usd", payment_type: "card", processor_response: "Approved", customer: { email: "A@B.co" } })).toEqual({ provider: "flutterwave", reference: "frenz_x", externalId: "987", status: "success", amountMinor: 1000, currency: "USD", channel: "card", paidAt: null, reason: "Approved", customerEmail: "a@b.co" });
  });
});

describe("definite refusal vs unknown outcome", () => {
  it("only a 4xx answer or our own refusal is definite; 5xx, timeouts, dropped connections and non-JSON bodies are unknown", () => {
    expect(flutterwaveFailureIsDefinite(new FlutterwaveHttpError("Invalid currency", 400))).toBe(true);
    expect(flutterwaveFailureIsDefinite(new FlutterwaveLocalRefusal("bad"))).toBe(true);
    expect(flutterwaveFailureIsDefinite(new FlutterwaveHttpError("upstream", 502))).toBe(false);
    const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    expect(flutterwaveFailureIsDefinite(timeout)).toBe(false);
    expect(flutterwaveFailureIsDefinite(new TypeError("fetch failed"))).toBe(false);
    expect(flutterwaveFailureIsDefinite(new SyntaxError("Unexpected token <"))).toBe(false);
  });
});

const cfg = resolveFlutterwaveConfig(FULL);
const answer = (status: number, body: unknown) => vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("the REST client (scripted fetch, no network)", () => {
  it("hosted checkout: POST /v3/payments with OUR reference, major units, the currency, our redirect — returns the link", async () => {
    const f = answer(200, { status: "success", message: "Hosted Link", data: { link: "https://checkout.flutterwave.com/v3/hosted/pay/abc" } });
    const link = await createFlutterwaveCheckout({ reference: "frenz_cr_topup_fw_1234abcd", amountMinor: 500, currency: "USD", email: "a@b.co", redirectUrl: "https://frenzsave.com/ai/usage", title: "Frenz AI credits" }, { cfg, fetch: f as unknown as typeof fetch });
    expect(link).toBe("https://checkout.flutterwave.com/v3/hosted/pay/abc");
    const [url, init] = f.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.flutterwave.com/v3/payments");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer FLWSECK_TEST-abc");
    expect(JSON.parse(init.body as string)).toMatchObject({ tx_ref: "frenz_cr_topup_fw_1234abcd", amount: 5, currency: "USD", redirect_url: "https://frenzsave.com/ai/usage", customer: { email: "a@b.co" } });
  });
  it("a 400 refusal is definite; a 503 is unknown; a 200 without a link is unknown", async () => {
    const refuse = createFlutterwaveCheckout({ reference: "frenz_ref_123456", amountMinor: 500, currency: "USD", email: "a@b.co", redirectUrl: "https://x.y", title: "t" }, { cfg, fetch: answer(400, { status: "error", message: "Invalid currency" }) as unknown as typeof fetch });
    await expect(refuse).rejects.toSatisfy(flutterwaveFailureIsDefinite);
    const down = createFlutterwaveCheckout({ reference: "frenz_ref_123456", amountMinor: 500, currency: "USD", email: "a@b.co", redirectUrl: "https://x.y", title: "t" }, { cfg, fetch: answer(503, { status: "error" }) as unknown as typeof fetch });
    await expect(down).rejects.toSatisfy((e: unknown) => !flutterwaveFailureIsDefinite(e));
    const noLink = createFlutterwaveCheckout({ reference: "frenz_ref_123456", amountMinor: 500, currency: "USD", email: "a@b.co", redirectUrl: "https://x.y", title: "t" }, { cfg, fetch: answer(200, { status: "success", data: {} }) as unknown as typeof fetch });
    await expect(noLink).rejects.toSatisfy((e: unknown) => !flutterwaveFailureIsDefinite(e));
  });
  it("an HTML error page (not JSON) is unknown", async () => {
    const html = createFlutterwaveCheckout({ reference: "frenz_ref_123456", amountMinor: 500, currency: "USD", email: "a@b.co", redirectUrl: "https://x.y", title: "t" }, { cfg, fetch: answer(502, "<html>Bad gateway</html>") as unknown as typeof fetch });
    await expect(html).rejects.toSatisfy((e: unknown) => !flutterwaveFailureIsDefinite(e));
  });
  it("no key: refused locally, nothing sent", async () => {
    const f = vi.fn();
    await expect(createFlutterwaveCheckout({ reference: "frenz_ref_123456", amountMinor: 500, currency: "USD", email: "a@b.co", redirectUrl: "https://x.y", title: "t" }, { cfg: resolveFlutterwaveConfig({}), fetch: f as unknown as typeof fetch })).rejects.toBeInstanceOf(FlutterwaveLocalRefusal);
    expect(f).not.toHaveBeenCalled();
  });
  it("verify by id and by reference hit the documented endpoints; 'not found' is a status, an auth failure is an error", async () => {
    const ok = answer(200, { status: "success", data: { id: 42, tx_ref: "frenz_ref_123456", status: "successful", amount: 5, currency: "USD" } });
    expect(await verifyFlutterwaveById("42", { cfg, fetch: ok as unknown as typeof fetch })).toMatchObject({ status: "success", amountMinor: 500, externalId: "42", reference: "frenz_ref_123456" });
    expect((ok.mock.calls[0]! as unknown as [string])[0]).toBe("https://api.flutterwave.com/v3/transactions/42/verify");
    const byRef = answer(200, { status: "success", data: { id: 43, tx_ref: "frenz_ref_123456", status: "pending", amount: 5, currency: "USD" } });
    expect(await verifyFlutterwaveByReference("frenz_ref_123456", { cfg, fetch: byRef as unknown as typeof fetch })).toMatchObject({ status: "pending" });
    expect((byRef.mock.calls[0]! as unknown as [string])[0]).toBe("https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=frenz_ref_123456");
    expect(await verifyFlutterwaveByReference("frenz_ref_123456", { cfg, fetch: answer(400, { status: "error", message: "No transaction was found" }) as unknown as typeof fetch })).toMatchObject({ status: "not_found" });
    await expect(verifyFlutterwaveById("42", { cfg, fetch: answer(401, { status: "error", message: "Invalid authorization key" }) as unknown as typeof fetch })).rejects.toBeInstanceOf(FlutterwaveHttpError);
    await expect(verifyFlutterwaveById("42; drop", { cfg })).rejects.toBeInstanceOf(FlutterwaveLocalRefusal);
  });
});

describe("matching a verified charge to OUR stored attempt", () => {
  const expected = { provider: "flutterwave" as const, reference: "frenz_r", amountMinor: 1000, currency: "USD" };
  const good = { provider: "flutterwave" as const, reference: "frenz_r", externalId: "1", status: "success" as const, amountMinor: 1000, currency: "USD", channel: null, paidAt: null, reason: null };
  it("Part 2.1: only the EXACT amount matches — one cent over is an overpayment held for review, one under is an underpayment", () => {
    expect(chargeMatches(good, expected)).toEqual({ ok: true });
    expect(chargeMatches({ ...good, amountMinor: 1001 }, expected)).toEqual({ ok: false, mismatch: "overpaid" });
    expect(chargeMatches({ ...good, amountMinor: 999 }, expected)).toEqual({ ok: false, mismatch: "underpaid" });
    expect(chargeMatches({ ...good, amountMinor: 1_000_000 }, expected)).toEqual({ ok: false, mismatch: "overpaid" });
  });
  it("a non-integer or unsafe amount never matches (no float tolerance)", () => {
    expect(chargeMatches({ ...good, amountMinor: 1000.0000001 }, expected)).toEqual({ ok: false, mismatch: "amount" });
    expect(chargeMatches({ ...good, amountMinor: Number.NaN }, expected)).toEqual({ ok: false, mismatch: "amount" });
    expect(chargeMatches({ ...good, amountMinor: 2 ** 60 }, expected)).toEqual({ ok: false, mismatch: "amount" });
  });
  it("currency is compared WITH the amount: the same digits in another currency never match", () => {
    expect(chargeMatches({ ...good, currency: "NGN" }, expected)).toEqual({ ok: false, mismatch: "currency" });
    expect(chargeMatches({ ...good, currency: "usd" }, expected)).toEqual({ ok: true });
  });
  it("wrong amount, wrong currency, wrong reference, wrong provider, not a success — each refused, saying why", () => {
    expect(chargeMatches({ ...good, amountMinor: 999 }, expected)).toEqual({ ok: false, mismatch: "underpaid" });
    expect(chargeMatches({ ...good, amountMinor: null }, expected)).toEqual({ ok: false, mismatch: "amount" });
    expect(chargeMatches({ ...good, currency: "NGN" }, expected)).toEqual({ ok: false, mismatch: "currency" });
    expect(chargeMatches({ ...good, reference: "frenz_other" }, expected)).toEqual({ ok: false, mismatch: "reference" });
    expect(chargeMatches({ ...good, provider: "paystack" }, expected)).toEqual({ ok: false, mismatch: "provider" });
    expect(chargeMatches({ ...good, status: "pending" }, expected)).toEqual({ ok: false, mismatch: "status" });
    expect(chargeMatches({ ...good, status: "failed" }, expected)).toEqual({ ok: false, mismatch: "status" });
  });
});

describe("the fallback rule — a backup rail only after a DEFINITE refusal", () => {
  it("definite refusal → the next rail is tried", async () => {
    const tried: string[] = [];
    const r = await firstRail(["flutterwave", "paystack"], async (p) => (tried.push(p), p === "flutterwave" ? { ok: false, refusal: "definite", status: 502, error: "no" } : { ok: true, value: "url" }));
    expect(tried).toEqual(["flutterwave", "paystack"]);
    expect(r).toEqual({ ok: true, value: "url" });
  });
  it("🔴 unknown outcome (timeout/5xx) → NO backup attempt: the first checkout may exist and be paid", async () => {
    const tried: string[] = [];
    const r = await firstRail(["flutterwave", "paystack"], async (p) => (tried.push(p), { ok: false, refusal: "unknown", status: 502, error: "unknown" }));
    expect(tried).toEqual(["flutterwave"]);
    expect(r).toMatchObject({ ok: false, refusal: "unknown" });
  });
  it("a success ends the loop", async () => {
    const tried: string[] = [];
    await firstRail(["flutterwave", "paystack"], async (p) => (tried.push(p), { ok: true, value: p }));
    expect(tried).toEqual(["flutterwave"]);
  });
});

describe("references name their provider and purpose", () => {
  it("each purpose mints its own shape; Paystack and Bachs references are not Flutterwave's", () => {
    for (const p of ["wallet_topup", "sub_purchase", "verification", "ad_campaign"] as const) {
      const r = newFlutterwaveReference(p);
      expect(flutterwaveReferencePurpose(r)).toBe(p);
      expect(r.length).toBeLessThanOrEqual(64);
      expect(r).toMatch(/^[A-Za-z0-9_-]+$/);
    }
    for (const r of ["frenz_cr_topup_2b1c8f8e-1111-4111-8111-111111111111", `frenz_sub_${"a".repeat(32)}`, `frenz_vf_${"a".repeat(32)}`, "frenz_bachs_topup_1", "frenz_cr_topup_fw_not-a-uuid", ""]) {
      expect(flutterwaveReferencePurpose(r), r).toBeNull();
    }
  });
});
