import { describe, expect, it } from "vitest";

import { offerView } from "./offer";

// Frenz Exclusive Part 4 — what the creator subscription card says, in every state.
const quote = { priceCents: 1000, feeCents: 100, totalCents: 1100, feePercent: 10, periodDays: 30 };
const base = { creatorName: "Amaka", quote, signedIn: true };

describe("the subscription card", () => {
  it("shows what the visitor PAYS (price + fee) and how it splits — not the bare price the old box showed", () => {
    const v = offerView({ ...base, membership: { state: "none" } });
    expect(v).toMatchObject({ tone: "offer", action: "subscribe", actionLabel: "Subscribe", priceLine: "$11.00 for 30 days", feeLine: "$10.00 to Amaka + $1.00 service fee" });
  });

  it("takes every number from the server's quote — a different quote, different words; no quote, no price at all", () => {
    expect(offerView({ ...base, quote: { priceCents: 499, feeCents: 49, totalCents: 548, feePercent: 10, periodDays: 7 }, membership: { state: "none" } }).priceLine).toBe("$5.48 for 7 days");
    const none = offerView({ ...base, quote: null, membership: { state: "none" } });
    expect(none).toMatchObject({ tone: "unavailable", action: "none", priceLine: null, feeLine: null });
    expect(JSON.stringify(none)).not.toMatch(/\$\d/);
    // a zero or broken quote is never shown as a price
    expect(offerView({ ...base, quote: { ...quote, totalCents: 0 }, membership: { state: "none" } }).tone).toBe("unavailable");
  });

  it("a fee of zero says so, rather than '+ $0.00'", () => {
    expect(offerView({ ...base, quote: { ...quote, feeCents: 0, totalCents: 1000, feePercent: 0 }, membership: { state: "none" } }).feeLine).toBe("All of it goes to Amaka");
  });

  it("an active subscriber sees their access date and no button — no second purchase offered", () => {
    const v = offerView({ ...base, membership: { state: "active", until: "2026-11-15T12:00:00Z" } });
    expect(v).toMatchObject({ tone: "active", action: "none", actionLabel: null, priceLine: null });
    expect(v.status).toContain("Nov 15, 2026");
    expect(v.status).toContain("doesn't renew automatically");
  });

  it("an expired subscriber is offered a renewal at today's price, through the same checkout", () => {
    const v = offerView({ ...base, membership: { state: "expired", endedAt: "2026-10-01T00:00:00Z" } });
    expect(v).toMatchObject({ tone: "expired", action: "renew", actionLabel: "Renew", priceLine: "$11.00 for 30 days" });
    expect(v.status).toContain("ended on");
  });

  it("a signed-out visitor is asked to sign in; an active subscriber of a paused creator still sees their access", () => {
    expect(offerView({ ...base, signedIn: false, membership: undefined })).toMatchObject({ action: "sign_in", actionLabel: "Sign in to subscribe" });
    expect(offerView({ ...base, quote: null, membership: { state: "active", until: null } }).tone).toBe("active");
  });
});
