import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { COIN_DEFAULTS, type FrenzCoinConfig } from "@/lib/coin/config";

/**
 * Frenz Coin Part 6 — the admin console's own decisions and first paint:
 *   · the settings form sends ONLY what changed, in integer cents / basis points; bounds point at the field; a fixed
 *     payout needs a rate the admin typed (there is no default rate); risky changes need explicit confirmation;
 *   · withdrawal actions follow the status, and paying is not offered without an approved payout rate;
 *   · deposit reversals read in the API's own states (no invented "rejected"), with open shortfalls flagged;
 *   · a correction needs a meaningful reason and stays inside the transfer's limits;
 *   · a money call never throws, reports a cancelled password prompt plainly, and carries the replay key unchanged.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const L = await import("./coin-admin-logic");
const { postMoney } = await import("./coin-admin-data");
const { CoinSettings } = await import("./coin-settings");
const { CoinAdminConsole } = await import("./coin-admin-console");

const cfg = (o: Partial<FrenzCoinConfig> = {}): FrenzCoinConfig => ({ ...COIN_DEFAULTS, ...o });

describe("settings form → patch", () => {
  it("unchanged form → empty patch", () => {
    const r = L.buildCoinPatch(L.formFromConfig(cfg()), cfg());
    expect(r).toEqual({ ok: true, patch: {}, changes: [] });
  });
  it("sends only the fields that changed, in cents and basis points", () => {
    const f = L.formFromConfig(cfg());
    f.transfers.percent = "9.5";
    f.deposits.holdHours = "3";
    f.withdrawals.min = "10";
    f.adminAlerts = "email";
    const r = L.buildCoinPatch(f, cfg());
    expect(r.ok && r.patch).toEqual({ adminAlerts: "email", deposits: { holdHours: 3 }, transfers: { percentBp: 950 }, withdrawals: { minCents: 1_000 } });
  });
  it("a fixed payout needs the rate the admin approved — no default is ever filled in", () => {
    const f = L.formFromConfig(cfg());
    expect(f.withdrawals.nairaPerUsd).toBe("");
    f.withdrawals.rateSource = "fixed";
    const bad = L.buildCoinPatch(f, cfg());
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.problems.map((p) => p.field)).toContain("withdrawals.nairaPerUsd");
    f.withdrawals.nairaPerUsd = "1,500.50";
    const ok = L.buildCoinPatch(f, cfg());
    expect(ok.ok && ok.patch).toEqual({ withdrawals: { payoutRateSource: "fixed", payoutMinorPerUsd: 150_050 } });
  });
  it("market / none never send a rate the admin didn't set", () => {
    const f = L.formFromConfig(cfg());
    f.withdrawals.rateSource = "market";
    const r = L.buildCoinPatch(f, cfg());
    expect(r.ok && r.patch).toEqual({ withdrawals: { payoutRateSource: "market" } });
  });
  it("out-of-range and junk values point at their field; cross-field rules too", () => {
    const f = L.formFromConfig(cfg());
    f.transfers.percent = "51";
    f.deposits.holdHours = "2161";
    f.withdrawals.max = "1";
    f.withdrawals.min = "5";
    f.pin.maxAttempts = "2";
    f.transfers.flatBelow = "abc";
    const r = L.buildCoinPatch(f, cfg());
    expect(!r.ok && r.problems.map((p) => p.field).sort()).toEqual(["deposits.holdHours", "pin.maxAttempts", "transfers.flatBelow", "transfers.percent", "withdrawals.max"].sort());
  });
  it("money is parsed without floating point; zero fees are allowed", () => {
    expect(L.dollarsToCents("0.29")).toBe(29);
    expect(L.dollarsToCents("0")).toBe(0);
    expect(L.dollarsToCents("1.005")).toBeNull();
    expect(L.percentToBp("6")).toBe(600);
    expect(L.percentToBp("10.25")).toBe(1_025);
    expect(L.bpToPercent(625)).toBe("6.25");
  });
  it("switching Frenz Coin on, the payout rate, fees and the hold must be confirmed", () => {
    const f = L.formFromConfig(cfg());
    f.enabled = true;
    f.withdrawals.rateSource = "market";
    f.transfers.flatAbove = "6";
    f.deposits.holdHours = "2";
    const r = L.buildCoinPatch(f, cfg());
    const risky = r.ok ? L.riskyChanges(r.changes, f) : [];
    expect(risky.join(" ")).toMatch(/switched ON/);
    expect(risky.join(" ")).toMatch(/market rate/);
    expect(risky.join(" ")).toMatch(/Fees change/);
    expect(risky.join(" ")).toMatch(/held 2 hour/);
    // teeth: an alerts-only change needs no confirmation
    const g = L.formFromConfig(cfg());
    g.adminAlerts = "push";
    const r2 = L.buildCoinPatch(g, cfg());
    expect(r2.ok ? L.riskyChanges(r2.changes, g) : ["x"]).toEqual([]);
  });
});

describe("withdrawals", () => {
  it("actions follow the status; paying needs an approved rate", () => {
    expect(L.withdrawalActions("pending", true)).toEqual(["review", "approve", "reject"]);
    expect(L.withdrawalActions("reviewing", true)).toEqual(["approve", "reject"]);
    expect(L.withdrawalActions("approved", true)).toEqual(["pay", "reject"]);
    expect(L.withdrawalActions("approved", false)).toEqual(["reject"]);
    for (const s of ["processing", "completed", "rejected", "cancelled", "reversed"]) expect(L.withdrawalActions(s, true)).toEqual([]);
    expect(L.WITHDRAWAL_STATUS.reversed!.label).toBe("Returned by bank");
  });
});

describe("deposit reversals", () => {
  const row = (o: Partial<import("./coin-admin-logic").ReversalRow>) => ({ id: "r", kind: "refund", reference: "x", userId: "u", phase: "released", state: "recovered", depositCents: 5_000, due: 5_000, recovered: 5_000, shortfall: 0, shortfallCleared: false, createdAt: "", ...o });
  it("each API state, with what can be recorded next", () => {
    expect(L.reversalView(row({ state: "disputed" }))).toMatchObject({ actions: ["resolve"], needsAction: true });
    expect(L.reversalView(row({ state: "review" })).label).toMatch(/pending review/);
    expect(L.reversalView(row({ state: "review" })).actions).toEqual(["apply_partial"]);
    expect(L.reversalView(row({ state: "applied" }))).toMatchObject({ actions: [], needsAction: false });
    expect(L.reversalView(row({ state: "restored" })).label).toMatch(/won/);
    expect(L.reversalView(row({ state: "lost" })).label).toMatch(/lost/);
  });
  it("an open shortfall needs settling; a settled one doesn't", () => {
    expect(L.reversalView(row({ shortfall: 1_200 }))).toMatchObject({ actions: ["clear"], tone: "rose" });
    expect(L.reversalView(row({ shortfall: 1_200 })).label).toMatch(/shortfall open/);
    expect(L.reversalView(row({ shortfall: 1_200, shortfallCleared: true }))).toMatchObject({ actions: [], needsAction: false });
  });
});

describe("transfer corrections", () => {
  const t = { feeCents: 600, feeRefundable: true, creditRemainingCents: 4_000 };
  it("needs a meaningful reason", () => {
    expect(L.correctionProblem(t, "fee_refund", "", "ok")).toMatch(/reason/);
    expect(L.correctionProblem(t, "fee_refund", "", "fee charged twice")).toBeNull();
  });
  it("stays inside the transfer's limits", () => {
    expect(L.correctionProblem({ ...t, feeRefundable: false }, "fee_refund", "", "fee charged twice")).toMatch(/already refunded/);
    expect(L.correctionProblem({ ...t, feeCents: 0, feeRefundable: false }, "fee_refund", "", "fee charged twice")).toMatch(/no fee/);
    expect(L.correctionProblem(t, "sender_credit", "40.01", "sent to the wrong person")).toMatch(/\$40\.00 left/);
    expect(L.correctionProblem(t, "sender_credit", "40", "sent to the wrong person")).toBeNull();
    expect(L.correctionProblem(t, "sender_credit", "0", "sent to the wrong person")).toMatch(/Enter the amount/);
  });
});

describe("money calls", () => {
  const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  it("ok → data; the body (and its replay key) is sent exactly as given", async () => {
    const f = vi.fn(async () => res(200, { ok: true, id: "c1" }));
    const r = await postMoney(f, "/x", { idempotencyKey: "adm_same" });
    expect(r).toEqual({ ok: true, data: { ok: true, id: "c1" } });
    expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ idempotencyKey: "adm_same" });
  });
  it("a password prompt the admin cancelled is said plainly", async () => {
    const r = await postMoney(async () => res(403, { error: "Confirm your password to continue.", code: "REAUTH_REQUIRED" }), "/x", {});
    expect(r).toMatchObject({ ok: false, reason: "reauth", error: expect.stringMatching(/nothing was changed/i) });
  });
  it("a bare 403 (session gone, e.g. after an admin password change) says what to do — never just 'Forbidden'", async () => {
    const r = await postMoney(async () => res(403, { error: "Forbidden" }), "/x", {});
    expect(r).toMatchObject({ ok: false, reason: "session" });
    expect(!r.ok && r.error).toMatch(/Refresh the page, sign in again/);
  });
  it("a refusal keeps the server's reason; a network failure never throws", async () => {
    expect(await postMoney(async () => res(409, { error: "That transfer's fee was already refunded.", reason: "already_refunded" }), "/x", {})).toMatchObject({ ok: false, reason: "already_refunded" });
    expect(await postMoney(async () => Promise.reject(new TypeError("offline")), "/x", {})).toMatchObject({ ok: false, reason: "network" });
  });
});

describe("first paint", () => {
  const sf = async () => new Response("{}");
  it("settings: the payout rate choice is explicit; none says withdrawals can't be paid; no rate field until fixed", () => {
    const m = renderToStaticMarkup(createElement(CoinSettings, { config: cfg(), sensitiveFetch: sf }));
    expect(m).toContain("Payout rate (naira)");
    expect(m).toMatch(/value="none"[^>]*checked|checked[^>]*value="none"/);
    expect(m).toContain("no bank payout is sent");
    expect(m).not.toContain("fc-rate-value");
    expect(m).toContain("Admin alerts for transfers and withdrawals");
    expect(m).toContain("No changes");
  });
  it("settings with a fixed rate show the approved rate (from the server, not a default)", () => {
    const m = renderToStaticMarkup(createElement(CoinSettings, { config: cfg({ withdrawals: { ...COIN_DEFAULTS.withdrawals, payoutRateSource: "fixed", payoutMinorPerUsd: 150_000 } }), sensitiveFetch: sf }));
    expect(m).toContain('value="1500.00"');
  });
  it("the console: four tabs, off for members, the rate stated", () => {
    const m = renderToStaticMarkup(createElement(CoinAdminConsole, { config: cfg() }));
    for (const t of ["Settings", "Withdrawals", "Transfers", "Deposit reversals"]) expect(m).toContain(`>${t}</button>`);
    expect(m).toContain("Off for members");
    expect(m).toContain("withdrawals can&#x27;t be paid");
  });
});
