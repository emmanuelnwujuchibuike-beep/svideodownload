import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { summarizeAiMoney, type MoneyLedgerRow } from "@/lib/ai/admin-money-view";

const row = (r: Partial<MoneyLedgerRow>): MoneyLedgerRow => ({ user_id: "u1", kind: "processing_charge", status: "settled", delta_cents: -10, currency: "CREDIT", created_at: "2026-10-07T00:00:00Z", ...r });

describe("the admin money summary (credit brief §18)", () => {
  const s = summarizeAiMoney(
    [
      row({ kind: "recharge", delta_cents: 100, paid_cents: "1000", status: "settled" }),
      row({ kind: "recharge", delta_cents: 50, paid_cents: null }),
      row({ kind: "bonus", delta_cents: 10 }),
      row({ kind: "processing_charge", delta_cents: -13, tool: "text_to_video", user_id: "a" }),
      row({ kind: "processing_charge", delta_cents: -7, tool: "lip_sync", user_id: "b" }),
      row({ kind: "processing_charge", delta_cents: -5, status: "reserved", tool: "lip_sync" }),
      row({ kind: "processing_charge", delta_cents: -9, status: "refunded", tool: "lip_sync" }),
      row({ kind: "refund", delta_cents: 9 }),
      row({ kind: "adjustment", delta_cents: -3 }),
      // a dollar row from before 0184 — never summed into credits
      row({ kind: "processing_charge", delta_cents: -500, currency: "USD", tool: "text_to_video" }),
    ],
    [
      { feature: "ai_text_to_video", status: "completed", provider_cost_usd_cents: "60", completed_at: null },
      { feature: "ai_lip_sync", status: "completed", provider_cost_usd_cents: null, completed_at: null },
    ],
    { windowDays: 30, centsPerCredit: 10 },
  );

  it("revenue is what top-ups settled; a top-up without a settled amount is counted, not guessed", () => {
    expect(s.topups).toEqual({ count: 2, credits: 150, bonusCredits: 10, revenueUsdCents: 1000, withoutPaidAmount: 1 });
  });
  it("spent counts settled charges only; reserved is separate; refunded charges are not spent", () => {
    expect(s.consumption).toEqual({ settledCredits: 20, reservedCredits: 5, jobs: 2 });
    expect(s.refunds).toEqual({ count: 1, credits: 9 });
  });
  it("by tool and by member, largest first", () => {
    expect(s.byFeature).toEqual([
      { tool: "text_to_video", credits: 13, jobs: 1 },
      { tool: "lip_sync", credits: 7, jobs: 1 },
    ]);
    expect(s.topUsers[0]).toEqual({ userId: "a", credits: 13 });
  });
  it("teeth: a dollar row is never mixed into a credit figure", () => {
    expect(s.legacyMoneyRows).toBe(1);
    expect(s.byFeature.find((f) => f.tool === "text_to_video")?.credits).toBe(13);
  });
  it("margin = credits spent at the rate − the provider estimate; none without an estimate", () => {
    expect(s.providerCost).toEqual({ usdCents: 60, jobs: 2, withEstimate: 1 });
    expect(s.estimatedMarginUsdCents).toBe(20 * 10 - 60);
    expect(summarizeAiMoney([], [], { windowDays: 30, centsPerCredit: 10 }).estimatedMarginUsdCents).toBeNull();
  });
  it("the read paginates (PostgREST stops at 1,000 rows silently)", () => {
    const src = readFileSync(join(process.cwd(), "lib/ai/admin-money.ts"), "utf8");
    expect(src.match(/paginatedSelect</g)?.length).toBe(2);
  });
});

describe("the wallet summary route", () => {
  it("is the session's own wallet — never a user id from the request", () => {
    const src = readFileSync(join(process.cwd(), "app/api/ai/wallet/summary/route.ts"), "utf8");
    expect(src).toContain("loadWalletSummary(subject.userId,");
    expect(src).not.toMatch(/searchParams\.get\("user/);
    const lib = readFileSync(join(process.cwd(), "lib/ai/wallet/summary.ts"), "utf8");
    // nothing internal leaves: no provider, model or USD cost
    expect(lib).not.toMatch(/providerCost|providerModel|actor_admin_id/);
  });
});
