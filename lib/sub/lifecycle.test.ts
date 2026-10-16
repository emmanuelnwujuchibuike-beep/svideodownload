import { describe, expect, it } from "vitest";

import {
  checkoutBlockedByActive,
  hasAccess,
  inRenewWindow,
  isReceipt,
  maskReference,
  reminderCopy,
  reminderDue,
  subActions,
  subState,
  txState,
  txView,
  type MembershipFacts,
  type TxRow,
} from "./lifecycle";

// Frenz Exclusive Part 5 — the subscription lifecycle, every state, on a fixed clock.
const NOW = Date.parse("2026-10-16T12:00:00Z");
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW + days * DAY).toISOString();
const m = (over: Partial<MembershipFacts> = {}): MembershipFacts => ({ status: "active", billing: "sub", periodEnd: at(20), periodIndex: 2, cancelPeriod: null, joinedAt: at(-40), ...over });
const ctx = (over: Partial<Parameters<typeof subState>[1]> = {}) => ({ now: NOW, blocked: false, creatorAvailable: true, lastPurchaseStatus: "paid", pendingPayment: false, ...over });

describe("cancellation keeps the paid period", () => {
  it("a cancelled subscription with time left still has access, and reads 'ending'", () => {
    const s = subState(m({ cancelPeriod: 2 }), ctx());
    expect(s).toBe("ending");
    expect(hasAccess(s)).toBe(true);
  });

  it("cancelling never extends access: once period_end passes, a cancelled subscription is expired", () => {
    const s = subState(m({ cancelPeriod: 2, periodEnd: at(-0.01) }), ctx());
    expect(s).toBe("expired");
    expect(hasAccess(s)).toBe(false);
  });

  it("a cancellation from an earlier period is stale: a renewal (period_index moved on) is active again", () => {
    expect(subState(m({ cancelPeriod: 1, periodIndex: 2 }), ctx())).toBe("active");
  });

  it("only an active, paid-up subscription can be cancelled; only an ending one resumed", () => {
    expect(subActions("active", m(), { now: NOW, canPurchase: true })).toMatchObject({ cancel: true, resume: false });
    expect(subActions("ending", m(), { now: NOW, canPurchase: true })).toMatchObject({ cancel: false, resume: true });
    for (const s of ["expired", "refunded", "removed", "unavailable", "pending", "ended"] as const) expect(subActions(s, m(), { now: NOW, canPurchase: true })).toMatchObject({ cancel: false, resume: false });
  });
});

describe("revocation beats everything", () => {
  it("a refunded / reversed purchase that ended the period reads refunded, never active", () => {
    for (const status of ["refunded", "disputed", "reversed"]) {
      const s = subState(m({ status: "ended", periodEnd: at(-1) }), ctx({ lastPurchaseStatus: status }));
      expect(s).toBe("refunded");
      expect(hasAccess(s)).toBe(false);
    }
  });

  it("a removed member is removed, whatever their period_end or cancellation says", () => {
    expect(subState(m({ status: "removed", periodEnd: at(20), cancelPeriod: 2 }), ctx())).toBe("removed");
    expect(subActions("removed", m(), { now: NOW, canPurchase: true }).renew).toBe(false);
  });

  it("a block either way, or a suspended creator, shows no access even with paid time left (as hasActiveSub)", () => {
    expect(hasAccess(subState(m(), ctx({ blocked: true })))).toBe(false);
    expect(hasAccess(subState(m({ cancelPeriod: 2 }), ctx({ creatorAvailable: false })))).toBe(false);
  });

  it("a free membership is never paid access", () => {
    expect(hasAccess(subState(m({ billing: "free", periodEnd: null }), ctx()))).toBe(false);
  });
});

describe("pending payments are not access", () => {
  it("a checkout in flight shows 'pending' — and only when there is no access", () => {
    const s = subState(m({ status: "ended", periodEnd: at(-3) }), ctx({ pendingPayment: true }));
    expect(s).toBe("pending");
    expect(hasAccess(s)).toBe(false);
    expect(subState(m(), ctx({ pendingPayment: true }))).toBe("active");
  });
});

describe("renewal and the duplicate-purchase guard", () => {
  it("renewing is offered after the end, and in the last 3 days — not earlier", () => {
    expect(subActions("expired", m({ periodEnd: at(-2) }), { now: NOW, canPurchase: true }).renew).toBe(true);
    expect(subActions("active", m({ periodEnd: at(2) }), { now: NOW, canPurchase: true }).renew).toBe(true);
    expect(subActions("active", m({ periodEnd: at(20) }), { now: NOW, canPurchase: true }).renew).toBe(false);
    // a creator who can't sell (paused, hidden, blocked) offers no renewal
    expect(subActions("expired", m({ periodEnd: at(-2) }), { now: NOW, canPurchase: false }).renew).toBe(false);
  });

  it("checkout is refused while paid up beyond the window, allowed inside it and after expiry", () => {
    expect(checkoutBlockedByActive(m({ periodEnd: at(20) }), NOW)).toBe(true);
    expect(checkoutBlockedByActive(m({ periodEnd: at(2.9) }), NOW)).toBe(false);
    expect(checkoutBlockedByActive(m({ periodEnd: at(-1) }), NOW)).toBe(false);
    expect(checkoutBlockedByActive(m({ status: "ended", periodEnd: at(20) }), NOW)).toBe(false);
    expect(checkoutBlockedByActive(null, NOW)).toBe(false);
  });

  it("the window is exactly 3 days, and never open for an ended period", () => {
    expect(inRenewWindow(at(3), NOW)).toBe(true);
    expect(inRenewWindow(at(3.01), NOW)).toBe(false);
    expect(inRenewWindow(at(-0.01), NOW)).toBe(false);
    expect(inRenewWindow(null, NOW)).toBe(false);
  });
});

const tx = (over: Partial<TxRow> = {}): TxRow => ({
  id: "p1",
  creatorId: "c1",
  status: "paid",
  createdAt: at(-5),
  paidAt: at(-5),
  reversedAt: null,
  priceCents: 1000,
  feeCents: 100,
  totalCents: 1100,
  chargedCurrency: "NGN",
  chargedMinor: 165000,
  periodDays: 30,
  periodStart: at(-5),
  periodEnd: at(25),
  reference: `frenz_sub_${"ab".repeat(16)}`,
  ...over,
});

describe("transactions and receipts", () => {
  it("every status is distinct, and only a settled charge reads as money taken", () => {
    const states = ["initiated", "failed", "paid", "refund_due", "refunded", "disputed", "reversed"].map((s) => txState(s, at(-0.01), NOW));
    expect(new Set(states).size).toBe(7);
    expect(isReceipt(txState("initiated", at(-0.01), NOW))).toBe(false);
    expect(isReceipt(txState("failed", at(-1), NOW))).toBe(false);
    expect(isReceipt(txState("paid", at(-1), NOW))).toBe(true);
  });

  it("an open checkout (what a browser redirect leaves behind) is never a receipt, and shows no charged amount or period", () => {
    const v = txView(tx({ status: "initiated", createdAt: at(-0.01), paidAt: null, periodStart: null, periodEnd: null }), NOW);
    expect(v).toMatchObject({ state: "pending", receipt: false, charged: null, periodStart: null, periodEnd: null });
    // an old one is "not completed", not pending forever
    expect(txView(tx({ status: "initiated", createdAt: at(-3) }), NOW).state).toBe("not_completed");
    // a status this build doesn't know is never shown as paid
    expect(txView(tx({ status: "weird" }), NOW)).toMatchObject({ state: "not_completed", receipt: false });
  });

  it("amounts come from the row: the charged amount in its currency, and the USD split", () => {
    const v = txView(tx(), NOW);
    expect(v.charged).toMatch(/^NGN\s1,650\.00$/);
    expect(v.breakdown).toEqual({ price: "$10.00", fee: "$1.00", total: "$11.00" });
    expect(txView(tx({ chargedMinor: 1100, chargedCurrency: "USD" }), NOW).charged).toBe("$11.00");
  });

  it("a refunded payment is still a receipt (money moved), marked refunded; a refund_due one granted no period", () => {
    expect(txView(tx({ status: "refunded", reversedAt: at(-1) }), NOW)).toMatchObject({ state: "refunded", receipt: true, label: "Refunded" });
    expect(txView(tx({ status: "refund_due" }), NOW)).toMatchObject({ state: "refund_due", receipt: true, periodStart: null, periodEnd: null });
  });

  it("the reference is shortened, and the view carries nothing but the listed fields", () => {
    expect(maskReference(`frenz_sub_${"0".repeat(22)}abcdef1234`)).toBe("SUB-…ABCDEF1234");
    const keys = Object.keys(txView(tx(), NOW)).sort();
    expect(keys).toEqual(["breakdown", "charged", "creatorId", "date", "id", "label", "note", "periodDays", "periodEnd", "periodStart", "receipt", "reference", "reversedAt", "state"]);
    expect(JSON.stringify(txView(tx(), NOW))).not.toContain("ab".repeat(16));
  });
});

describe("reminders", () => {
  it("the most relevant reminder only, at 3 days, 1 day and after the end", () => {
    expect(reminderDue(at(10), NOW)).toBeNull();
    expect(reminderDue(at(2.5), NOW)).toBe("renew_3d");
    expect(reminderDue(at(0.5), NOW)).toBe("renew_1d");
    expect(reminderDue(at(-0.5), NOW)).toBe("expired");
    expect(reminderDue(at(-3), NOW)).toBeNull();
  });

  it("the copy never claims automatic renewal, and names nothing but the creator", () => {
    for (const k of ["renew_3d", "renew_1d", "expired"] as const) {
      const c = reminderCopy(k, "Amaka", true);
      const text = `${c.title} ${c.body}`;
      expect(text).not.toMatch(/will (auto|automatically )?renew|auto-renew is on|renews? on/i);
      expect(text).toContain("Amaka");
    }
    expect(reminderCopy("renew_3d", "Amaka", true).body).toContain("doesn't renew automatically");
  });
});
