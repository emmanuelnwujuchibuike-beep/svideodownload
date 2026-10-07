/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE CREDIT — the one unit a member sees and the wallet holds (0184)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-10-07: "convert the currency to credits and not USD but billed
 * in USD / currencies supported by the provider." 1 credit = $0.10 (the
 * operator's `frenzAiPlans.credits.centsPerCredit`, the same rate the AI-plan
 * allowance already counted in).
 *
 * Pure — no imports — so the browser, the routes and the tests share it.
 *
 * ── How a price becomes credits ─────────────────────────────────────────────
 * Every tool keeps its own pricing engine and its own LIST price in USD cents
 * (the admin compares it with the provider's USD cost). ONE function turns
 * that list price into credits — `calculateCredits` in ./engine.ts — and the
 * SAME number is what an AI plan's allowance counts and what the wallet is
 * charged. There is no second credit formula anywhere.
 *
 * ── How credits are bought ──────────────────────────────────────────────────
 * A pack is N credits (+ bonus) at N × centsPerCredit USD cents; the payment
 * provider converts that to the checkout currency (lib/ai/wallet/packs.ts).
 */

/** The wallet's unit, written on every `ai_product_ledger` / `ai_product_balances` row from 0184 on. */
export const WALLET_UNIT = "CREDIT" as const;

/** `1234` → `"1,234 credits"`, `1` → `"1 credit"`. A whole number always: the wallet holds whole credits. */
export function formatCredits(credits: number, opts: { short?: boolean } = {}): string {
  const n = Number.isFinite(credits) ? Math.round(credits) : 0;
  const shown = n.toLocaleString("en-US");
  if (opts.short) return shown;
  return `${shown} ${Math.abs(n) === 1 ? "credit" : "credits"}`;
}

/** What N credits cost in USD cents at the operator's rate — a pack's price before any provider conversion. */
export function creditsToUsdCents(credits: number, centsPerCredit: number): number {
  return Math.max(0, Math.round(credits)) * Math.max(1, Math.round(centsPerCredit));
}

/**
 * The facts a "not enough credits" refusal carries, in ONE shape for every
 * tool, so the one "Top up credits / Get AI Pro" prompt can read any of them.
 */
export function walletShortfall(balanceCredits: number, requiredCredits: number, extra: Record<string, unknown> = {}) {
  return { balanceCredits, requiredCredits, shortfallCredits: Math.max(0, requiredCredits - balanceCredits), unit: WALLET_UNIT, ...extra };
}

/**
 * A ledger row's amount, as the member reads it. Rows from before 0184 were
 * written in money (USD cents, or kobo before 0159) and keep their unit — the
 * statement prints each row in its own.
 */
export function formatLedgerAmount(amount: number, unit: string | null | undefined, opts: { signed?: boolean } = {}): string {
  const sign = opts.signed ? (amount > 0 ? "+" : amount < 0 ? "−" : "") : amount < 0 ? "−" : "";
  const abs = Math.abs(Math.round(amount));
  if (!unit || unit === WALLET_UNIT) return `${sign}${formatCredits(abs)}`;
  const symbol = unit === "NGN" ? "₦" : unit === "USD" ? "$" : `${unit} `;
  return `${sign}${symbol}${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}
