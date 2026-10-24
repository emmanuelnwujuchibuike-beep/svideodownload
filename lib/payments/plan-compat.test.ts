import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { aiPlanShownUsdCents, displayPriceUsdCents, flutterwavePlanCompat } = await import("./plan-compat");

/** Part 6 — a Flutterwave payment plan is used only at the price members are shown (lib/payments/plan-compat.ts). */
const ok = { active: true, currency: "USD", amountMinor: 499, interval: "monthly" };

describe("flutterwavePlanCompat", () => {
  it("an active monthly USD plan at exactly the shown price is compatible", () => {
    expect(flutterwavePlanCompat(ok, { amountMinor: 499, interval: "monthly" })).toEqual({ ok: true });
    expect(flutterwavePlanCompat({ ...ok, interval: "" }, { amountMinor: 499, interval: "monthly" })).toEqual({ ok: true });
    expect(flutterwavePlanCompat({ ...ok, interval: "annually" }, { amountMinor: 499, interval: "yearly" })).toEqual({ ok: true });
  });
  it("the owner's 2026-10-24 plans are refused with the precise reason (NGN / USDT; amounts ≠ shown)", () => {
    expect(flutterwavePlanCompat({ active: true, currency: "NGN", amountMinor: 2000, interval: "monthly" }, { amountMinor: 2000, interval: "monthly" })).toMatchObject({ ok: false, reason: "currency", detail: expect.stringContaining("NGN") });
    expect(flutterwavePlanCompat({ active: true, currency: "USDT", amountMinor: 199, interval: "monthly" }, { amountMinor: 499, interval: "monthly" })).toMatchObject({ ok: false, reason: "currency", detail: expect.stringContaining("USDT") });
    expect(flutterwavePlanCompat({ ...ok, amountMinor: 199 }, { amountMinor: 499, interval: "monthly" })).toMatchObject({ ok: false, reason: "amount_mismatch", detail: "The Flutterwave plan charges USD 1.99 but members are shown USD 4.99. Make them equal (edit the plan, or the shown price)." });
  });
  it("inactive, no fixed amount, a shown price that isn't USD, or another interval → refused", () => {
    expect(flutterwavePlanCompat({ ...ok, active: false }, { amountMinor: 499, interval: "monthly" })).toMatchObject({ reason: "inactive" });
    expect(flutterwavePlanCompat({ ...ok, amountMinor: null }, { amountMinor: 499, interval: "monthly" })).toMatchObject({ reason: "no_fixed_amount" });
    expect(flutterwavePlanCompat(ok, { amountMinor: null, interval: "monthly" })).toMatchObject({ reason: "price_unknown" });
    expect(flutterwavePlanCompat({ ...ok, interval: "yearly" }, { amountMinor: 499, interval: "monthly" })).toMatchObject({ reason: "interval_mismatch" });
  });
});

describe("shown prices", () => {
  it("parses a plain US-dollar display price, never converts anything else", () => {
    expect(displayPriceUsdCents("$4.99")).toBe(499);
    expect(displayPriceUsdCents("4.99")).toBe(499);
    expect(displayPriceUsdCents("$10")).toBe(1000);
    expect(displayPriceUsdCents("US$ 9.9")).toBe(990);
    expect(displayPriceUsdCents("USD 9.99")).toBe(999);
    for (const s of ["₦2,500", "Free", "4,99 €", "$4.999", "", null, "$ 4.99 / mo"]) expect(displayPriceUsdCents(s), String(s)).toBeNull();
  });
  it("an AI plan's shown price counts only when the AI price list is in USD", () => {
    expect(aiPlanShownUsdCents(1000, "USD")).toBe(1000);
    expect(aiPlanShownUsdCents(1000, "usd")).toBe(1000);
    expect(aiPlanShownUsdCents(1000, "NGN")).toBeNull();
    expect(aiPlanShownUsdCents(0, "USD")).toBeNull();
  });
});
