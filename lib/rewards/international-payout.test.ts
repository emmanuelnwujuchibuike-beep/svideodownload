import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { validatePayoutDetails } from "@/lib/rewards/withdrawals";

/*
  Owner 2026-10-12: payouts for creators outside Nigeria — a bank wire or PayPal, paid
  by hand from the admin queue. A Nigerian Paystack account cannot pay them.
*/
const bank = { rail: "bank", country: "gh", accountName: "Ama Mensah", bankName: "GCB Bank", accountNumber: "1234 5678 9012", swift: "gcblghac" };
describe("international payout details", () => {
  it("a bank wire needs the holder, the bank, an account / IBAN and a SWIFT code", () => {
    const d = validatePayoutDetails("international", bank);
    expect(d).toMatchObject({ rail: "bank", country: "GH", swift: "GCBLGHAC", accountName: "Ama Mensah" });
    expect(validatePayoutDetails("international", { ...bank, swift: "BAD" })).toBeNull();
    expect(validatePayoutDetails("international", { ...bank, bankName: "" })).toBeNull();
  });

  it("PayPal needs the holder and a real-looking email", () => {
    expect(validatePayoutDetails("international", { rail: "paypal", country: "US", accountName: "Jo Doe", email: "Jo@Example.com" })).toMatchObject({ rail: "paypal", email: "jo@example.com", bankName: "PayPal" });
    expect(validatePayoutDetails("international", { rail: "paypal", country: "US", accountName: "Jo Doe", email: "not-an-email" })).toBeNull();
  });

  it("Nigeria is refused — Nigerian banks are paid through Paystack (teeth)", () => {
    expect(validatePayoutDetails("international", { ...bank, country: "NG" })).toBeNull();
    expect(validatePayoutDetails("international", { ...bank, country: "Ghana" })).toBeNull();
  });

  it("an international withdrawal is never sent to Paystack automatically", () => {
    const src = readFileSync("lib/sub/server.ts", "utf8");
    expect(src).toMatch(/if \(cfg\.autoPayout && method === "paystack"\)/);
    expect(src).toMatch(/p_method: method,/);
  });
});
