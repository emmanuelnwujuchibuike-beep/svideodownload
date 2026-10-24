import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { koboFor } from "./paystack-banks";
import { validatePayoutDetails } from "./withdrawals";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("Paystack payouts", () => {
  it("pays the USD value at the naira rate, rounded down to the kobo", () => {
    // $12.34 at 1,500.55 NGN per USD = NGN 18,516.787 → 1,851,678 kobo
    expect(koboFor(1234, 1500.55)).toBe(1_851_678);
    expect(koboFor(0, 1500)).toBe(0);
    expect(koboFor(-5, 1500)).toBe(0);
  });

  it("a Paystack payout needs a 10-digit account and a bank code, and never trusts a typed name", () => {
    const ok = validatePayoutDetails("paystack", { bankCode: "058", bankName: "GTBank", accountNumber: "0123456789", accountName: "Someone Else" });
    expect(ok).toMatchObject({ bankCode: "058", accountNumber: "0123456789", accountName: "" });
    expect(validatePayoutDetails("paystack", { bankCode: "058", bankName: "GTBank", accountNumber: "12345" })).toBeNull();
    expect(validatePayoutDetails("paystack", { bankCode: "<x>", bankName: "GTBank", accountNumber: "0123456789" })).toBeNull();
    expect(validatePayoutDetails("crypto", { accountNumber: "0123456789" })).toBeNull();
  });

  it("the account name is filled from Paystack before a request is stored", () => {
    const w = src("lib/rewards/withdrawals.ts");
    expect(w).toContain('const name = await resolveAccount(details.accountNumber, details.bankCode ?? "");');
    expect(w).toContain("details.accountName = name;");
  });

  it("one fixed reference per withdrawal, so a retry can never pay twice", () => {
    const p = src("lib/rewards/paystack-payouts.ts");
    expect(p).toContain("const REF = PAYSTACK_REF;");
    expect(src("lib/rewards/payout-refs.ts")).toContain("export const PAYSTACK_REF = (withdrawalId: string) => `frenz_wd_${withdrawalId.replace(/-/g, \"\")}`;");
    expect(p).toContain("reference, reason: \"Frenz withdrawal\"");
  });

  it("the webhook settles transfers, and only our own references", () => {
    const hook = src("app/api/paystack/webhook/route.ts");
    for (const e of ["transfer.success", "transfer.failed", "transfer.reversed"]) expect(hook).toContain(`"${e}"`);
    expect(hook).toContain("await settlePaystackTransfer(event.event, event.data?.reference ?? undefined);");
    // 2026-10-24: our Paystack (frenz_wd_) and Flutterwave (frenz_fwd_) payout references only
    expect(src("lib/rewards/paystack-payouts.ts")).toContain("if (!isPayoutRef(reference)) return false;");
    expect(src("lib/rewards/payout-refs.ts")).toContain('(r.startsWith("frenz_wd_") || r.startsWith("frenz_fwd_"))');
  });

  it("a failed or reversed transfer returns the credits (rejected), a success completes", () => {
    expect(src("lib/rewards/paystack-payouts.ts")).toContain('const to = event === "transfer.success" ? "completed" : "rejected";');
  });
});
