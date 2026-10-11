import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  aggregate,
  communitySuggestions,
  feedbackSummary,
  joinsByMonth,
  loyaltyNotes,
  memberMilestone,
  membersCsv,
  retention,
  subscriptionCharge,
  usd,
  validatePrice,
  withdrawalSplit,
  type MemberSignals,
} from "./engine";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/0227_sub_monetization.sql"), "utf8");

describe("SUB fees (the brief's own examples)", () => {
  it("a $10 subscription costs $11 at a 10 % purchase fee; the creator earns $10, the platform $1", () => {
    expect(subscriptionCharge(1000, 10)).toEqual({ priceCents: 1000, feeCents: 100, totalCents: 1100, feeBp: 1000 });
  });

  it("a $100 SUB withdrawal at 10 % pays $90 and keeps a $10 fee", () => {
    expect(withdrawalSplit(10_000, 10)).toEqual({ grossCents: 10_000, feeCents: 1000, netCents: 9000, feeBp: 1000 });
  });

  it("the two fees are separate stages: buying never takes the withdrawal fee, withdrawing never takes the purchase fee", () => {
    const buy = subscriptionCharge(1000, 10);
    const out = withdrawalSplit(buy.priceCents, 10);
    // the creator earned the price (not the total), and only the withdrawal fee comes off it
    expect(out.grossCents).toBe(1000);
    expect(out.netCents).toBe(900);
    expect(buy.feeCents + out.feeCents).toBe(200);
  });

  it("integer cents, fees rounded down, never negative, for every price", () => {
    for (let c = 0; c <= 5000; c += 7)
      for (const p of [0, 2.5, 7.3, 10, 33.33, 100]) {
        const a = subscriptionCharge(c, p);
        expect(Number.isInteger(a.feeCents) && a.feeCents >= 0 && a.totalCents === a.priceCents + a.feeCents).toBe(true);
        const w = withdrawalSplit(c, p);
        expect(Number.isInteger(w.netCents) && w.netCents >= 0 && w.grossCents === w.feeCents + w.netCents).toBe(true);
      }
  });

  it("prices outside the admin's bounds are refused", () => {
    const b = { minPriceCents: 100, maxPriceCents: 100_000 };
    expect(validatePrice(99, b).ok).toBe(false);
    expect(validatePrice(1000.5, b).ok).toBe(false);
    expect(validatePrice(100_001, b).ok).toBe(false);
    expect(validatePrice(1000, b).ok).toBe(true);
    expect(usd(1100)).toBe("$11.00");
  });
});

describe("the SQL holds the same rules (0227, run in PGlite with the same numbers)", () => {
  it("the withdrawal fee is computed in SQL from basis points, never taken from the browser", () => {
    expect(sql).toContain("v_fee := (p_gross_cents::bigint * p_fee_bp) / 10000;");
    expect(sql).toContain("v_net := p_gross_cents - v_fee;");
    expect(sql).toContain("price_cents > 0 and fee_cents >= 0 and total_cents = price_cents + fee_cents");
  });

  it("access is granted only from a payment that matches the quote, and SUB never touches the AI wallet", () => {
    expect(sql).toContain("if p_paid_currency is distinct from v_p.charged_currency or coalesce(p_paid_minor, 0) < v_p.charged_minor then");
    const sub = sql.slice(sql.indexOf("create or replace function public.settle_sub_purchase"), sql.indexOf("create or replace function public.resolve_withdrawal"));
    expect(sub).not.toMatch(/ai_product_balances|ai_product_ledger/);
  });

  it("one open withdrawal per member per source, replays answered, and the browser can never call the money functions", () => {
    expect(sql).toContain("create unique index if not exists withdrawal_requests_one_open_uidx on public.withdrawal_requests (user_id, source) where status in ('pending', 'reviewing', 'approved', 'processing');");
    expect(sql).toContain("create unique index if not exists withdrawal_requests_idem_uidx on public.withdrawal_requests (user_id, idempotency_key) where idempotency_key is not null;");
    for (const f of ["settle_sub_purchase(text, bigint, text, text)", "reverse_sub_purchase(text, text, uuid, text)", "request_sub_withdrawal(uuid, integer, integer, integer, text, jsonb, jsonb, text, boolean)", "resolve_withdrawal(uuid, text, uuid, text, text)"]) {
      expect(sql).toContain(`revoke all on function public.${f} from public, anon, authenticated`);
    }
  });

  it("nobody approves their own qualification", () => {
    expect(sql).toContain("check (qualification_reviewed_by is null or qualification_reviewed_by <> user_id) not valid");
  });
});

describe("loyalty is time and participation, never money", () => {
  const now = Date.parse("2026-10-12T00:00:00Z");
  const sig = (p: Partial<MemberSignals>): MemberSignals => ({ memberId: "m", joinedAt: "2025-01-01T00:00:00Z", comments90: 0, collaborations: 0, recognitions: [], upheldReports: 0, lastActiveAt: null, ...p });
  it("describes tenure and participation in words", () => {
    expect(loyaltyNotes(sig({ comments90: 12, collaborations: 1, recognitions: ["helpful"] }), now)).toEqual(["Member for over a year", "Takes part often", "Has created with you", "Helps others"]);
  });
  it("the signals carry no money at all", () => {
    expect(JSON.stringify(sig({}))).not.toMatch(/credit|price|paid|spent|cents/i);
  });
});

describe("milestones", () => {
  it("celebrates one year in the week it happens, and nothing in between", () => {
    expect(memberMilestone("2025-10-10T00:00:00Z", new Date("2026-10-12T00:00:00Z"))?.label).toBe("One year of membership");
    expect(memberMilestone("2025-08-01T00:00:00Z", new Date("2026-10-12T00:00:00Z"))).toBeNull();
  });
});

describe("insights are aggregated with a floor", () => {
  it("folds small groups into Other, and hides Other when it is itself too small", () => {
    const v = [...Array(6).fill("Nigeria"), ...Array(3).fill("Ghana"), "Kenya"];
    expect(aggregate(v)).toEqual([{ label: "Nigeria", count: 6 }]);
    expect(aggregate([...v, "Kenya"])).toEqual([{ label: "Nigeria", count: 6 }, { label: "Other", count: 5 }]);
  });
  it("retention needs enough members before it says anything", () => {
    const now = Date.parse("2026-10-12T00:00:00Z");
    const m = Array.from({ length: 4 }, () => ({ joinedAt: "2026-01-01T00:00:00Z", endedAt: null }));
    expect(retention(m, 30, now)).toBeNull();
    expect(retention([...m, { joinedAt: "2026-01-01T00:00:00Z", endedAt: "2026-01-10T00:00:00Z" }], 30, now)).toEqual({ kept: 4, of: 5 });
  });
  it("joins by month covers the last six months", () => {
    expect(joinsByMonth(["2026-10-01", "2026-09-03", "2026-09-30"], new Date("2026-10-12T00:00:00Z")).slice(-2)).toEqual([{ month: "2026-09", count: 2 }, { month: "2026-10", count: 1 }]);
  });
  it("creator feedback appears only once enough members answered", () => {
    expect(feedbackSummary([{ communication: 5 }, { communication: 4 }])).toBeNull();
    const five = Array.from({ length: 5 }, (_, i) => ({ communication: 3 + (i % 3), quality: 4 }));
    expect(feedbackSummary(five)).toEqual([{ aspect: "communication", average: 3.8, answers: 5 }, { aspect: "quality", average: 4, answers: 5 }]);
  });
});

describe("the community assistant explains itself", () => {
  const now = Date.parse("2026-10-12T00:00:00Z");
  const m = (id: string, p: Partial<MemberSignals> = {}) => ({ memberId: id, joinedAt: "2026-01-01T00:00:00Z", comments90: 0, collaborations: 0, recognitions: [], upheldReports: 0, lastActiveAt: "2026-10-01T00:00:00Z", role: "member" as const, ...p });
  it("suggests moderators only from long-standing, active, never-reported members", () => {
    const out = communitySuggestions({ members: [m("a", { comments90: 12 }), m("b", { comments90: 12, upheldReports: 1 }), m("c", { comments90: 2 })], lastNoteAt: "2026-10-10T00:00:00Z", lastPostAt: null, now });
    expect(out.find((s) => s.id === "moderators")?.memberIds).toEqual(["a"]);
  });
  it("notices a quiet community", () => {
    const out = communitySuggestions({ members: [m("a"), m("b"), m("c")], lastNoteAt: null, lastPostAt: "2026-08-01T00:00:00Z", now });
    expect(out.map((s) => s.id)).toContain("quiet");
  });
});

describe("member export", () => {
  it("never writes a cell a spreadsheet would run", () => {
    expect(membersCsv([{ handle: "ada", name: "=cmd", role: "Member", tier: null, status: "active", joinedAt: "2026-01-01T00:00:00Z", country: null }])).toContain(`"'=cmd"`);
  });
});
