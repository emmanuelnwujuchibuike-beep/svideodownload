import { describe, expect, it } from "vitest";

import { payoutHoldReasons, type PayoutRiskFacts } from "./payout-risk";

const NOW = Date.parse("2026-10-24T12:00:00Z");
const RULES = { autoPayoutMaxCents: 50_000, autoPayoutDailyMaxCents: 100_000, newAccountHoldHours: 24 };
const SAFE: PayoutRiskFacts = { amountCents: 10_000, accountVerifiedAt: "2026-10-01T00:00:00Z", last24hCents: 0, sharedAccount: false, emailConfirmed: true };

describe("instant-payout fraud gate (2026-10-24)", () => {
  it("a known account, a normal amount, a confirmed email: paid at once", () => {
    expect(payoutHoldReasons(SAFE, RULES, NOW)).toEqual([]);
  });
  it("a bank account verified under 24 hours ago — or not the saved one — is held", () => {
    expect(payoutHoldReasons({ ...SAFE, accountVerifiedAt: "2026-10-24T00:00:00Z" }, RULES, NOW)).toEqual(["new_account"]);
    expect(payoutHoldReasons({ ...SAFE, accountVerifiedAt: "2026-10-23T11:59:59Z" }, RULES, NOW)).toEqual([]);
    expect(payoutHoldReasons({ ...SAFE, accountVerifiedAt: null }, RULES, NOW)).toEqual(["new_account"]);
  });
  it("single and 24-hour limits, at the boundary", () => {
    expect(payoutHoldReasons({ ...SAFE, amountCents: 50_000 }, RULES, NOW)).toEqual([]);
    expect(payoutHoldReasons({ ...SAFE, amountCents: 50_001 }, RULES, NOW)).toEqual(["over_single", ]);
    expect(payoutHoldReasons({ ...SAFE, last24hCents: 90_000, amountCents: 10_000 }, RULES, NOW)).toEqual([]);
    expect(payoutHoldReasons({ ...SAFE, last24hCents: 90_001, amountCents: 10_000 }, RULES, NOW)).toEqual(["over_daily"]);
  });
  it("a shared (mule) account and an unconfirmed email are held", () => {
    expect(payoutHoldReasons({ ...SAFE, sharedAccount: true }, RULES, NOW)).toEqual(["shared_account"]);
    expect(payoutHoldReasons({ ...SAFE, emailConfirmed: false }, RULES, NOW)).toEqual(["email"]);
  });
  it("anything unreadable fails CLOSED", () => {
    for (const k of ["last24hCents", "sharedAccount", "emailConfirmed"] as const) expect(payoutHoldReasons({ ...SAFE, [k]: null }, RULES, NOW)).toContain("unknown");
  });
});
