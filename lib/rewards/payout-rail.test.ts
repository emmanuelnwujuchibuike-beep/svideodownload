import { describe, expect, it } from "vitest";

import { coinPayoutRail, DEFAULT_PAYOUT_ROUTE, normalizePayoutRoute, PAYOUT_ROUTE_LABELS, PAYOUT_ROUTES, PAYSTACK_PAYOUT_COUNTRIES, payoutDestinationCountry } from "./payout-rail";

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

// owner, 2026-10-29: one clean path — Flutterwave only (default), Paystack only, or Flutterwave with Paystack as backup
describe("withdrawal payout routes", () => {
  it("offers exactly the three routes, Flutterwave only by default", () => {
    expect([...PAYOUT_ROUTES]).toEqual(["flutterwave", "paystack", "flutterwave_paystack_backup"]);
    expect(DEFAULT_PAYOUT_ROUTE).toBe("flutterwave");
    for (const r of PAYOUT_ROUTES) expect(PAYOUT_ROUTE_LABELS[r].length).toBeGreaterThan(0);
    expect(PAYOUT_ROUTE_LABELS.flutterwave).toMatch(/only/i);
  });

  it("reads anything unknown as Flutterwave only — never as the backup pair (teeth)", () => {
    for (const r of PAYOUT_ROUTES) expect(normalizePayoutRoute(r)).toBe(r);
    for (const v of [undefined, null, "", "by_country", "FLUTTERWAVE", 1]) expect(normalizePayoutRoute(v)).toBe("flutterwave");
  });
});
