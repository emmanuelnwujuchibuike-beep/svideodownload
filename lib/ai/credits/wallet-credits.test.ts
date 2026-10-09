import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { formatCompactCredits, formatCredits, formatLedgerAmount, walletShortfall, WALLET_UNIT } from "@/lib/ai/credits/units";
import { AI_WALLET_DEFAULTS, creditsForPayment, normalizeAiWalletConfig, publicWalletOffer, resolvePurchase } from "@/lib/ai/credits/wallet-config";

/**
 * 0184 — the Frenz AI wallet holds CREDITS (owner, 2026-10-07: "convert the
 * currency to credits and not USD but billed in USD"). These pin the three
 * things that move real money: what a payment buys, what a charge reserves,
 * and that no unit can cross into a wallet of another.
 */
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const CPC = 10;

describe("credit packs: what a member can buy", () => {
  const cfg = normalizeAiWalletConfig({
    packs: [
      { credits: 100, bonusCredits: 10, enabled: true },
      { credits: 50, enabled: true },
      { credits: 500, enabled: false },
      { credits: 100, bonusCredits: 999 }, // a duplicate size — dropped, the first wins
    ],
    custom: { enabled: true, minCredits: 20, maxCredits: 2000 },
  });

  it("normalises: one pack per size, sorted, the first of a duplicate kept", () => {
    expect(cfg.packs.map((p) => p.credits)).toEqual([50, 100, 500]);
    expect(cfg.packs.find((p) => p.credits === 100)?.bonusCredits).toBe(10);
  });

  it("a pack id prices at credits × centsPerCredit, bonus included", () => {
    expect(resolvePurchase({ packId: "pack_100" }, cfg, CPC)).toEqual({ credits: 100, bonusCredits: 10, priceUsdCents: 1000, packId: "pack_100" });
  });

  it("refuses a disabled pack, an unknown pack, and a custom amount outside the bounds", () => {
    expect("error" in resolvePurchase({ packId: "pack_500" }, cfg, CPC)).toBe(true);
    expect("error" in resolvePurchase({ packId: "pack_7" }, cfg, CPC)).toBe(true);
    expect("error" in resolvePurchase({ credits: 19 }, cfg, CPC)).toBe(true);
    expect("error" in resolvePurchase({ credits: 2001 }, cfg, CPC)).toBe(true);
    expect("error" in resolvePurchase({ credits: 25.5 }, cfg, CPC)).toBe(true);
    expect(resolvePurchase({ credits: 25 }, cfg, CPC)).toEqual({ credits: 25, bonusCredits: 0, priceUsdCents: 250, packId: null });
  });

  it("refuses a custom amount when the custom amount is off", () => {
    const packsOnly = normalizeAiWalletConfig({ ...cfg, custom: { ...cfg.custom, enabled: false } });
    expect("error" in resolvePurchase({ credits: 25 }, packsOnly, CPC)).toBe(true);
  });

  it("the public offer carries sizes and prices, never a provider key", () => {
    const offer = publicWalletOffer(cfg, CPC);
    expect(offer.packs.map((p) => p.credits)).toEqual([50, 100]);
    expect(offer.packs[1]?.priceUsdCents).toBe(1000);
    expect(JSON.stringify(offer)).not.toMatch(/sk_|secret|key/i);
  });

  it("the defaults are the five dollar shortcuts that were live before, as credits — no invented bonus", () => {
    expect(AI_WALLET_DEFAULTS.packs.map((p) => [p.credits, p.bonusCredits])).toEqual([
      [50, 0],
      [100, 0],
      [250, 0],
      [500, 0],
      [1000, 0],
    ]);
  });
});

describe("🔴 what a VERIFIED payment buys comes from the amount paid, never the metadata", () => {
  const cfg = normalizeAiWalletConfig({ packs: [{ credits: 100, bonusCredits: 10, enabled: true }] });

  it("a paid pack earns its credits and its bonus", () => {
    expect(creditsForPayment({ paidUsdCents: 1000, packId: "pack_100" }, cfg, CPC)).toEqual({ credits: 100, bonusCredits: 10, packId: "pack_100" });
  });

  it("a forged pack id on a smaller payment earns the paid credits and NO bonus", () => {
    // somebody initialises a $1 charge with our public key and writes pack_100 into the metadata
    expect(creditsForPayment({ paidUsdCents: 100, packId: "pack_100" }, cfg, CPC)).toEqual({ credits: 10, bonusCredits: 0, packId: null });
  });

  it("a payment from before the switch (dollars, no pack) still buys its dollars' worth of credits", () => {
    expect(creditsForPayment({ paidUsdCents: 500 }, cfg, CPC)).toEqual({ credits: 50, bonusCredits: 0, packId: null });
  });

  it("rounds a part-credit DOWN — a payment never mints a credit it did not pay for", () => {
    expect(creditsForPayment({ paidUsdCents: 1009 }, cfg, CPC).credits).toBe(100);
  });
});

describe("display", () => {
  it("formats credits as whole numbers", () => {
    expect(formatCredits(1)).toBe("1 credit");
    expect(formatCredits(1234)).toBe("1,234 credits");
    expect(formatCredits(12.6)).toBe("13 credits");
  });
  it("counts a balance in K from 1,000 (owner, 2026-10-09), rounding DOWN so it never overstates", () => {
    expect(formatCompactCredits(0)).toBe("0");
    expect(formatCompactCredits(101)).toBe("101");
    expect(formatCompactCredits(999)).toBe("999");
    expect(formatCompactCredits(1000)).toBe("1K");
    expect(formatCompactCredits(1050)).toBe("1K");
    expect(formatCompactCredits(1500)).toBe("1.5K");
    expect(formatCompactCredits(1999)).toBe("1.9K");
    expect(formatCompactCredits(12_345)).toBe("12.3K");
    expect(formatCompactCredits(999_999)).toBe("999.9K");
    expect(formatCompactCredits(1_000_000)).toBe("1M");
    expect(formatCompactCredits(2_500_000)).toBe("2.5M");
    expect(formatCompactCredits(Number.NaN)).toBe("0");
  });
  it("prints every statement row in its OWN unit", () => {
    expect(formatLedgerAmount(-13, WALLET_UNIT, { signed: true })).toBe("−13 credits");
    expect(formatLedgerAmount(51865, "USD")).toBe("$518.65");
    expect(formatLedgerAmount(50000, "NGN", { signed: true })).toBe("+₦500.00");
    expect(formatLedgerAmount(7, null)).toBe("7 credits");
  });
  it("a shortfall is one shape, in credits", () => {
    expect(walletShortfall(4, 13)).toMatchObject({ balanceCredits: 4, requiredCredits: 13, shortfallCredits: 9, unit: "CREDIT" });
  });
});

/* ─────────────────── the code that charges the wallet ─────────────────── */

const WALLET_CHARGERS = ["lib/ai/video/create.ts", "lib/ai/lip-sync/start-job.ts", "lib/ai/text-to-audio/generate.ts", "lib/ai/voice-clone/start.ts", "lib/ai/character-replace/start-job.ts"];

/** Every wallet reservation in a source file, and whether each one names its credits. */
function reservationsIn(src: string): { total: number; withCredits: number } {
  const calls = [...src.matchAll(/reserve(?:AiWallet|CharacterReplace)Charge\(\{([^\n]*)\}\)/g)];
  return { total: calls.length, withCredits: calls.filter((m) => /\bcredits: \w+\.creditsRequired\b/.test(m[1] ?? "")).length };
}

describe("🔴 every wallet charge reserves the engine's CREDITS", () => {
  it("the scanner has teeth: a reservation without credits is caught", () => {
    const bad = `await reserveAiWalletCharge({ userId: ownerId, jobId: job.id, snapshot: s });`;
    const good = `await reserveAiWalletCharge({ userId: ownerId, jobId: job.id, credits: walletCharge.creditsRequired, snapshot: s });`;
    expect(reservationsIn(bad)).toEqual({ total: 1, withCredits: 0 });
    expect(reservationsIn(good)).toEqual({ total: 1, withCredits: 1 });
  });

  for (const file of WALLET_CHARGERS) {
    it(`${file}: every reservation carries creditsRequired, and the balance is never compared to a cents total`, () => {
      const src = code(file);
      const r = reservationsIn(src);
      expect(r.total, "no wallet reservation found — did the call move?").toBeGreaterThan(0);
      expect(r.withCredits).toBe(r.total);
      expect(src).not.toMatch(/balanceBefore\s*<\s*[\w.]*(?:totalCents|totalUsdCents)/);
    });
  }

  it("the wallet writer refuses a charge that is not a whole number of credits, and always writes the CREDIT unit", () => {
    const w = code("lib/ai/character-replace/wallet.ts");
    expect(w).toContain("p_amount: credits,");
    expect(w).toContain("p_currency: WALLET_UNIT,");
    expect(w).not.toContain("p_amount: Math.round(opts.snapshot.totalCents)");
  });
});

describe("🔴 0184 — no unit crosses into a wallet of another", () => {
  const sql = code("supabase/migrations/0184_ai_wallet_credits.sql");
  const fn = (name: string) => {
    const start = sql.indexOf(`create or replace function public.${name}(`);
    expect(start, name).toBeGreaterThan(-1);
    return sql.slice(start, sql.indexOf("$$;", start));
  };
  for (const name of ["credit_product_balance", "reserve_product_charge", "adjust_product_balance"]) {
    it(`${name} raises on a unit mismatch BEFORE anything moves`, () => {
      const body = fn(name);
      const guard = body.indexOf("raise exception 'wallet unit mismatch");
      const firstWrite = Math.min(...["insert into", "update public.ai_product_balances"].map((w) => body.indexOf(w)).filter((i) => i > -1));
      expect(guard).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(firstWrite);
      expect(body).toContain("default 'CREDIT'");
    });
  }
  it("the conversion rounds UP in the member's favour and converts in-flight reservations so their refund lands", () => {
    expect(sql).toContain("ceil(r.balance_cents::numeric / v_cents_per_credit)");
    expect(sql).toMatch(/where kind = 'processing_charge' and status = 'reserved' and currency = 'USD'/);
    // the in-flight conversion runs BEFORE the balances flip to CREDIT
    expect(sql.indexOf("status = 'reserved' and currency = 'USD'")).toBeLessThan(sql.indexOf("set balance_cents = v_new, currency = 'CREDIT'"));
  });
  it("revokes the writers from the browser roles", () => {
    expect(sql).toContain("revoke all on function %s from public, anon, authenticated");
  });
});
