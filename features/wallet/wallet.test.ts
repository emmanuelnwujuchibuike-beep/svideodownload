import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frenz Coin Part 5 — the wallet UI. No DOM test runner exists in this repo (vitest.config.ts), so the screens are
 * rendered to markup on the server exactly as the first paint is, and the decisions behind them are pure functions:
 *   · what each screen offers comes from the SERVER summary (disabled, PIN missing / locked / unavailable, suspended,
 *     no payout rate) — and a closed screen renders NO money controls;
 *   · amounts are integer cents, parsed without floating point;
 *   · the API client never throws, words a 401 as an expired session, and treats a cancelled request as nothing;
 *   · the bank list is fetched once and shared (deduped in flight, a failure not cached);
 *   · a refused PIN never gets a hint; a deposit redirect alone is never "paid".
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => "/wallet" }));

const { coins, fc, signedFc, parseCoinInput, signedCoins, walletNumber, groupByDay, newKey, coinParts, releaseLabel } = await import("./money");
const { CoinAmount } = await import("./coin-amount");
const { transferGate, withdrawGate, depositGate, amountProblem, depositVerifyView, withdrawalStatusView, entryDirection, failMessage } = await import("./state");
const { walletApi, wasAborted } = await import("./api");
const { loadBanksOnce, _resetBanksCache } = await import("./use-wallet-runtime");
const { WalletOverview } = await import("./wallet-overview");
const { WalletTransfer } = await import("./wallet-transfer");
const { WalletWithdraw } = await import("./wallet-withdraw");
const { WalletDeposit } = await import("./wallet-deposit");
const { WalletSecurity } = await import("./wallet-security");
const { WalletActivity } = await import("./wallet-activity");
type Summary = import("./api").WalletSummary;

function summary(over: Partial<Summary> = {}, t: Partial<Summary["transfers"]> = {}, w: Partial<Summary["withdrawals"]> = {}): Summary {
  const base: Summary = {
    enabled: true,
    currency: "USD",
    centsPerCoin: 100,
    walletNumber: "1203682058",
    availableCents: 24_850_00,
    pendingCents: 5_000,
    heldCents: 0,
    totalCents: 24_900_00,
    pendingDeposits: [{ amountCents: 5_000, settledAt: "2026-10-24T10:00:00Z", releaseAt: "2026-10-27T10:00:00Z", status: "held" }],
    nextReleaseAt: "2026-10-27T10:00:00Z",
    deposits: { enabled: true, holdHours: 1, minCents: 100, maxCents: 500_000 },
    transfers: { enabled: true, canSend: true, blockedBy: null, pin: { set: true, lockedUntil: null }, minCents: 100, maxCents: 500_000, dailyMaxCents: 1_000_000, feeExamples: [] },
    withdrawals: { enabled: true, percentBp: 600, flatCents: 0, minCents: 500, maxCents: 500_000, payoutRateApproved: true, example: { grossCents: 10_000, feeCents: 600, netCents: 9_400 } },
  };
  return { ...base, ...over, transfers: { ...base.transfers, ...t }, withdrawals: { ...base.withdrawals, ...w } };
}
const off = () => summary({ enabled: false }, { enabled: false, canSend: false, blockedBy: "disabled" }, { enabled: false, payoutRateApproved: false });
const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);

describe("money helpers — integer cents, no floating point", () => {
  it("parses what a member types into cents, or null", () => {
    expect(parseCoinInput("50")).toBe(5_000);
    expect(parseCoinInput("50.5")).toBe(5_050);
    expect(parseCoinInput("1,250.75")).toBe(125_075);
    expect(parseCoinInput("0.29")).toBe(29); // 0.29 * 100 = 28.999… in floats — string arithmetic gives 29
    expect(parseCoinInput("1.005")).toBeNull();
    for (const bad of ["", "0", "0.00", "-5", "abc", "5e2", "1.2.3"]) expect(parseCoinInput(bad), bad).toBeNull();
  });
  it("formats coins, signs, parts and wallet numbers", () => {
    expect(coins(2_485_000)).toBe("24,850.00");
    expect(signedCoins(5_000)).toBe("+50.00");
    expect(signedCoins(-5_600)).toBe("−56.00");
    expect(coinParts(2_485_075)).toEqual({ whole: "24,850", fraction: ".75" });
    expect(walletNumber("1203682058")).toBe("120 368 2058");
  });
  it("writes Frenz Coin as a currency: the code first, never split from the figure", () => {
    expect(fc(2_485_000)).toBe("FC 24,850.00");
    expect(fc(-5_600)).toBe("−FC 56.00");
    expect(signedFc(5_000)).toBe("+FC 50.00");
    const m = renderToStaticMarkup(createElement(CoinAmount, { cents: 2_485_075 }));
    expect(m).toContain('aria-label="FC 24,850.75"');
    expect(m.indexOf(">FC<")).toBeLessThan(m.indexOf(">24,850<"));
    expect(m).toContain(".75");
  });
  it("groups activity by day and labels holds", () => {
    const now = new Date("2026-10-25T12:00:00");
    const g = groupByDay([{ at: "2026-10-25T09:00:00" }, { at: "2026-10-25T08:00:00" }, { at: "2026-10-24T08:00:00" }], now);
    expect(g.map((x) => [x.label, x.rows.length])).toEqual([["Today", 2], ["Yesterday", 1]]);
    expect(releaseLabel(new Date(Date.now() + 3 * 86_400_000).toISOString())).toBe("in 3 days");
    expect(releaseLabel("2000-01-01T00:00:00Z")).toBe("any moment now");
  });
  it("idempotency keys are fresh, prefixed and within the API's shape", () => {
    const a = newKey("cxf"), b = newKey("cxf");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^cxf_[A-Za-z0-9]{8,76}$/);
  });
});

describe("what each screen may offer — decided by the server summary", () => {
  it("transfers: open / disabled / no PIN / locked / PIN service unavailable / suspended", () => {
    expect(transferGate(summary())).toEqual({ open: true });
    expect(transferGate(off())).toMatchObject({ open: false, reason: "disabled" });
    expect(transferGate(summary({}, { canSend: false, blockedBy: "pin_not_set", pin: { set: false, lockedUntil: null } }))).toMatchObject({ open: false, reason: "pin_not_set", action: { href: "/wallet/security" } });
    expect(transferGate(summary({}, { canSend: false, blockedBy: "pin_locked", pin: { set: true, lockedUntil: "2099-01-01T00:00:00Z" } }))).toMatchObject({ open: false, reason: "pin_locked" });
    expect(transferGate(summary({}, { canSend: false, blockedBy: "authorization_unavailable" }))).toMatchObject({ open: false, reason: "authorization_unavailable" });
    // the server says "can't send" for a reason the client doesn't know (a restriction): still closed
    expect(transferGate(summary({}, { canSend: false, blockedBy: null }))).toMatchObject({ open: false, reason: "suspended" });
  });
  it("withdrawals: closed with no approved payout rate, off, no PIN, locked", () => {
    expect(withdrawGate(summary())).toEqual({ open: true });
    expect(withdrawGate(summary({}, {}, { payoutRateApproved: false }))).toMatchObject({ open: false, reason: "payout_rate" });
    expect(withdrawGate(off())).toMatchObject({ open: false, reason: "disabled" });
    expect(withdrawGate(summary({}, { pin: { set: false, lockedUntil: null } }))).toMatchObject({ open: false, reason: "pin_not_set" });
    expect(withdrawGate(summary({}, { pin: { set: true, lockedUntil: "2099-01-01T00:00:00Z" } }))).toMatchObject({ open: false, reason: "pin_locked" });
  });
  it("deposits follow the switch", () => {
    expect(depositGate(summary())).toEqual({ open: true });
    expect(depositGate(summary({}, {}, {}))).toEqual({ open: true });
    expect(depositGate({ ...summary(), deposits: { ...summary().deposits, enabled: false } })).toMatchObject({ open: false });
  });
  it("amount checks use the published limits and the available balance", () => {
    expect(amountProblem(null, { minCents: 100, maxCents: 500 })).toMatch(/Enter an amount/);
    expect(amountProblem(50, { minCents: 100, maxCents: 500 })).toMatch(/smallest/);
    expect(amountProblem(600, { minCents: 100, maxCents: 500 })).toMatch(/largest/);
    expect(amountProblem(400, { minCents: 100, maxCents: 500 }, 300)).toMatch(/available/);
    expect(amountProblem(300, { minCents: 100, maxCents: 500 }, 300)).toBeNull();
  });
});

describe("statuses, worded for the member", () => {
  it("a deposit return: confirmed / still pending / failed / review", () => {
    expect(depositVerifyView("on_hold")).toMatchObject({ tone: "success", final: true });
    expect(depositVerifyView("pending")).toMatchObject({ final: false });
    expect(depositVerifyView("pending").title).not.toMatch(/confirmed/i);
    expect(depositVerifyView("failed")).toMatchObject({ tone: "error", final: true });
    expect(depositVerifyView("review")).toMatchObject({ final: true });
    expect(depositVerifyView("error")).toMatchObject({ final: false });
  });
  it("withdrawals: pending / rejected / paid / returned by the bank", () => {
    expect(withdrawalStatusView("pending").label).toBe("In review");
    expect(withdrawalStatusView("rejected").message).toMatch(/went back to your wallet/);
    expect(withdrawalStatusView("completed").label).toBe("Paid");
    expect(withdrawalStatusView("reversed")).toMatchObject({ label: "Returned by bank", badge: "returned" });
    expect(withdrawalStatusView("reversed").message).toMatch(/returned to your wallet/);
  });
  it("money in / money out", () => {
    expect(entryDirection("deposit", 5_000)).toBe("in");
    expect(entryDirection("transfer_out", -5_000)).toBe("out");
    expect(entryDirection("withdrawal_reversal", 5_000)).toBe("in");
    expect(entryDirection("adjustment", -1)).toBe("out");
  });
  it("a refused PIN gets one generic message; an expired session says so", () => {
    const pinFail = { ok: false as const, status: 403, reason: "authorization_failed", error: "anything the server said" };
    expect(failMessage(pinFail, "transfer")).toBe("That PIN wasn't accepted. Check it, or try again later. Nothing was sent.");
    expect(failMessage(pinFail, "withdrawal")).toMatch(/Nothing was held/);
    expect(failMessage({ ok: false, status: 401, reason: "session", error: "", session: "expired" }, "transfer")).toMatch(/session ended/);
    expect(failMessage({ ok: false, status: 429, reason: null, error: "" }, "pin")).toMatch(/Too many attempts/);
  });
});

describe("the API client — never throws, no-store, cancellable", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("ok → data; requests are never cached by the browser", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { kind: "transfer", amountCents: 5000, feeCents: 600, totalCents: 5600 }));
    const r = await walletApi.quote("transfer", 5000);
    expect(r).toMatchObject({ ok: true, data: { feeCents: 600 } });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/coin/quote?kind=transfer&amountCents=5000");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ cache: "no-store", credentials: "same-origin" });
  });
  it("401 → session expired (not a generic error)", async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: "Please sign in." }));
    expect(await walletApi.summary()).toMatchObject({ ok: false, status: 401, session: "expired" });
  });
  it("an API refusal keeps the server's reason and words", async () => {
    fetchMock.mockResolvedValueOnce(json(403, { error: "That PIN wasn't accepted.", reason: "authorization_failed" }));
    expect(await walletApi.transfer({ accountNumber: "1203682058", amountCents: 5000, idempotencyKey: "cxf_abcdefgh", note: null, pin: "482915" })).toMatchObject({ ok: false, status: 403, reason: "authorization_failed" });
  });
  it("offline → a calm network error; a 500 with no JSON → a generic 'nothing was changed'", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await walletApi.history(null)).toMatchObject({ ok: false, status: 0, reason: "network" });
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 502 }));
    expect(await walletApi.summary()).toMatchObject({ ok: false, status: 502, error: "Something went wrong. Nothing was changed." });
  });
  it("a cancelled request is 'aborted' — shown as nothing", async () => {
    const c = new AbortController();
    fetchMock.mockImplementationOnce(() => {
      c.abort();
      return Promise.reject(new DOMException("aborted", "AbortError"));
    });
    const r = await walletApi.lookup("1203682058", c.signal);
    expect(wasAborted(r)).toBe(true);
  });
  it("a retried transfer carries the SAME idempotency key it was given (the client never mints one per call)", async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true, transferId: "t1", amountCents: 5000, feeCents: 600, totalCents: 5600, duplicate: false }));
    const body = { accountNumber: "1203682058", amountCents: 5000, idempotencyKey: "cxf_samekey123", note: null, pin: "482915" };
    await walletApi.transfer(body);
    await walletApi.transfer(body);
    const keys = fetchMock.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)).idempotencyKey);
    expect(keys).toEqual(["cxf_samekey123", "cxf_samekey123"]);
  });
  it("the bank list: one request however many screens ask at once; a failure is retried next time", async () => {
    _resetBanksCache();
    fetchMock.mockResolvedValueOnce(json(503, { banks: [] }));
    const [a, b] = await Promise.all([loadBanksOnce(), loadBanksOnce()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.ok || b.ok).toBe(false);
    fetchMock.mockResolvedValueOnce(json(200, { banks: [{ name: "Test Bank", code: "001" }] }));
    expect(await loadBanksOnce()).toMatchObject({ ok: true });
    await loadBanksOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("first paint of each screen (server-rendered markup)", () => {
  it("Frenz Coin off: an unavailable state and NO money controls anywhere", () => {
    const o = html(createElement(WalletOverview, { summary: off(), history: null, depositRef: null, loadedAt: 1 }));
    expect(o).toMatch(/isn(&#x27;|')t available yet/);
    for (const href of ["/wallet/deposit", "/wallet/transfer", "/wallet/withdraw"]) expect(o).not.toContain(`href="${href}"`);
    expect(html(createElement(WalletTransfer, { summary: off() }))).not.toContain("Review transfer");
    expect(html(createElement(WalletWithdraw, { summary: off(), withdrawals: [] }))).not.toContain("Review withdrawal");
    expect(html(createElement(WalletDeposit, { summary: off() }))).not.toContain("Continue to pay");
    expect(html(createElement(WalletActivity, { history: null, disabled: true, loadedAt: 1 }))).not.toContain("Load more");
  });

  it("enabled: the server's balance, hold, wallet number and the three actions", () => {
    const o = html(createElement(WalletOverview, { summary: summary(), history: { items: [], next: null }, depositRef: null, loadedAt: 1 }));
    expect(o).toContain("24,850");
    expect(o).toContain("120 368 2058");
    expect(o).toContain(fc(5_000)); // on hold, written as a currency
    for (const href of ["/wallet/deposit", "/wallet/transfer", "/wallet/withdraw"]) expect(o).toContain(`href="${href}"`);
    expect(o).toContain("No activity yet");
  });

  it("returning from the checkout shows 'checking', never 'paid', before the server answers", () => {
    const o = html(createElement(WalletOverview, { summary: summary(), history: { items: [], next: null }, depositRef: "frenz_coin_dep_fw_x", loadedAt: 1 }));
    expect(o).toContain("Checking your payment");
    expect(o).not.toContain("Payment confirmed");
  });

  it("transfer without a PIN: no form, a way to set one", () => {
    const t = html(createElement(WalletTransfer, { summary: summary({}, { canSend: false, blockedBy: "pin_not_set", pin: { set: false, lockedUntil: null } }) }));
    expect(t).toContain("Set up a transaction PIN first");
    expect(t).toContain('href="/wallet/security"');
    expect(t).not.toContain("Review transfer");
  });

  it("transfer allowed: the form, the fee rule in words, and NO client-computed fee figure", () => {
    const t = html(createElement(WalletTransfer, { summary: summary() }));
    expect(t).toContain("Review transfer");
    expect(t).toContain("10% plus $1 under $100");
    expect(t).not.toMatch(/Fee<\/dt><dd[^>]*>\d/);
  });

  it("withdraw with no approved payout rate: unavailable, past requests still listed, bank returns explained", () => {
    const w = html(
      createElement(WalletWithdraw, {
        summary: summary({}, {}, { payoutRateApproved: false }),
        withdrawals: [{ id: "w1", status: "reversed", grossCents: 10_000, feeCents: 600, netCents: 9_400, payout: null, bank: { name: "Test Bank", last4: "6789" }, createdAt: "2026-10-20T10:00:00Z", updatedAt: null }],
      }),
    );
    expect(w).toContain("Withdrawals aren");
    expect(w).not.toContain("Review withdrawal");
    expect(w).toContain("Returned by bank");
    expect(w).toContain("••6789");
  });

  it("withdraw allowed: a request already open blocks a second one", () => {
    const w = html(createElement(WalletWithdraw, { summary: summary(), withdrawals: [{ id: "w1", status: "pending", grossCents: 10_000, feeCents: 600, netCents: 9_400, payout: null, bank: { name: "B", last4: "1234" }, createdAt: "2026-10-20T10:00:00Z", updatedAt: null }] }));
    expect(w).toContain("You have a withdrawal in progress");
  });

  it("deposit: the hold is explained and there is no fee or markup", () => {
    const d = html(createElement(WalletDeposit, { summary: summary() }));
    expect(d).toContain("After a 1 hour hold");
    expect(html(createElement(WalletDeposit, { summary: summary({ deposits: { ...summary().deposits, holdHours: 0 } }) }))).toContain("Right away");
    expect(d).toContain("1 FC = $1.00");
    expect(d).toContain("None");
    expect(d).not.toMatch(/card fee|processing fee|instant/i);
  });

  it("security: unavailable / set up / change, PIN fields masked and never autofilled", () => {
    expect(html(createElement(WalletSecurity, { pin: { available: false, set: false, lockedUntil: null } }))).toContain("Transaction PINs aren");
    const setup = html(createElement(WalletSecurity, { pin: { available: true, set: false, lockedUntil: null } }));
    expect(setup).toContain("Set your transaction PIN");
    expect(setup).toMatch(/type="password"[^>]*inputMode="numeric"|inputMode="numeric"[^>]*type="password"/i);
    expect(setup).toContain('autoComplete="off"');
    const change = html(createElement(WalletSecurity, { pin: { available: true, set: true, lockedUntil: null } }));
    expect(change).toContain("Change your PIN");
    expect(change).toContain("Forgot your PIN?");
    const locked = html(createElement(WalletSecurity, { pin: { available: true, set: true, lockedUntil: "2099-01-01T00:00:00Z" } }));
    expect(locked).toContain("Reset your PIN");
  });

  it("teeth: a gate that ignored the server's 'canSend: false' would be caught", () => {
    const leaky = (s: Summary) => (s.enabled ? { open: true } : { open: false });
    expect(leaky(summary({}, { canSend: false, blockedBy: null }))).not.toEqual(transferGate(summary({}, { canSend: false, blockedBy: null })));
  });
});

describe("the wallet entry points' shared balance read (coin-glance)", () => {
  const fetchMock = vi.fn();
  beforeEach(async () => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    (await import("./coin-glance"))._resetCoinGlance();
  });
  afterEach(() => vi.unstubAllGlobals());
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it("Frenz Coin off → no request at all", async () => {
    const g = await import("./coin-glance");
    expect(g.refreshCoinGlanceIfStale(false)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("every entry point on screen shares ONE request; fresh for 2 minutes; a money action re-reads", async () => {
    const g = await import("./coin-glance");
    fetchMock.mockResolvedValue(ok({ enabled: true, availableCents: 2_485_000, walletNumber: "1203682058" }));
    expect(g.refreshCoinGlanceIfStale(true)).toBe(true);
    expect(g.refreshCoinGlanceIfStale(true)).toBe(false); // in flight: shared
    await vi.waitFor(() => expect(g.keptCoinGlance()).toEqual({ availableCents: 2_485_000, walletNumber: "1203682058" }));
    expect(g.refreshCoinGlanceIfStale(true)).toBe(false); // fresh
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(g.refreshCoinGlanceIfStale(true, Date.now() + 3 * 60_000)).toBe(true); // stale → once more
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 0)); // the second read settles
    g.invalidateCoinGlance();
    expect(g.refreshCoinGlanceIfStale(true)).toBe(true);
  });
  it("a wallet that answers 'disabled' (or fails) shows nothing — never a placeholder figure", async () => {
    const g = await import("./coin-glance");
    fetchMock.mockResolvedValueOnce(ok({ enabled: false, availableCents: 0 }));
    g.refreshCoinGlanceIfStale(true);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(g.keptCoinGlance()).toBeNull();
  });
  it("the entry points render nothing on first paint (before the member's balance is known)", async () => {
    const { CoinHeaderPill, CoinMenuCard, CoinChatSend } = await import("./coin-entry");
    // the /downloads header button (owner, 2026-10-25): the wallet icon only — NEVER a balance on the Download page
    const pill = renderToStaticMarkup(createElement(CoinHeaderPill));
    expect(pill).toContain('href="/wallet"');
    expect(pill).toContain('aria-label="Frenz Coin wallet"');
    expect(pill).not.toContain(">FC<");
    expect(pill).not.toMatch(/>[0-9][0-9,]*(\.[0-9]{2})?</);
    // and while Frenz Coin is off (first paint: entitlements not ready) the header shows nothing at all
    const { CoinHeaderPillLazy } = await import("./coin-entry-lazy");
    expect(renderToStaticMarkup(createElement(CoinHeaderPillLazy))).toBe("");
    expect(renderToStaticMarkup(createElement(CoinMenuCard))).toBe("");
    expect(renderToStaticMarkup(createElement(CoinChatSend, { recipientId: "x", name: "Bo" }))).toBe("");
  });
});
