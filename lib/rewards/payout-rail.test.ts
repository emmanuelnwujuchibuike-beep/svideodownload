import { describe, expect, it } from "vitest";

import { coinPayoutRail, PAYSTACK_PAYOUT_COUNTRIES, payoutDestinationCountry } from "./payout-rail";

// owner, 2026-10-27: Nigeria, Ghana and Paystack's other payout countries through Paystack; beyond, Flutterwave
describe("coin payout rail", () => {
  it("Paystack for Nigeria, Ghana, South Africa and Kenya, whatever the case", () => {
    expect([...PAYSTACK_PAYOUT_COUNTRIES]).toEqual(["NG", "GH", "ZA", "KE"]);
    for (const c of ["NG", "gh", " ZA ", "Ke"]) expect(coinPayoutRail(c)).toBe("paystack");
  });
  it("Flutterwave beyond them, and when the country is unknown", () => {
    for (const c of ["US", "GB", "CM", "", null, undefined, "NGA"]) expect(coinPayoutRail(c)).toBe("flutterwave");
  });
  it("the destination: the details' own country, else Nigeria for the Nigerian bank method, else unknown", () => {
    expect(payoutDestinationCountry({ payout_method: "paystack", payout_details: { bankCode: "058" } })).toBe("NG");
    expect(payoutDestinationCountry({ payout_method: "paystack", payout_details: { country: "gh" } })).toBe("GH");
    expect(payoutDestinationCountry({ payout_method: "international", payout_details: { country: "Ghana" } })).toBeNull();
    expect(payoutDestinationCountry({ payout_method: "international", payout_details: null })).toBeNull();
  });
});
