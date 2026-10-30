/**
 * The USD value of a payment an affiliate earns a share of (Rewards v2, 0255).
 *
 * `amount_minor` is in the attempt's own currency (the wallet currency for a
 * top-up, USD for an AI plan or an ad). In order:
 *   1. USD — the amount as is;
 *   2. the rate pinned on the attempt at checkout (`fx_minor_per_usd`);
 *   3. today's market rate (units per $1), given by the caller.
 * Null when none can name it: the commission stays queued, never a guessed
 * number. Rounded DOWN — a fraction of a cent is never paid out.
 */
export interface CommissionAmount {
  amount_minor: number;
  currency: string;
  fx_minor_per_usd: number | null;
}

export function commissionUsdCents(row: CommissionAmount, marketPerUsd: number | null, centsPerCredit: number | null = null): number | null {
  const amount = Number(row.amount_minor);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  // 0309: a share of DEPOSITED CREDITS SPENT ON AI — worth what the member paid for them (the top-up price per credit)
  if (row.currency.toUpperCase() === "CREDIT") return centsPerCredit !== null && Number.isFinite(centsPerCredit) && centsPerCredit > 0 ? Math.floor(amount * centsPerCredit) : null;
  if (row.currency.toUpperCase() === "USD") return Math.floor(amount);
  const pinned = Number(row.fx_minor_per_usd);
  if (Number.isFinite(pinned) && pinned > 0) return Math.floor((amount * 100) / pinned);
  if (marketPerUsd !== null && Number.isFinite(marketPerUsd) && marketPerUsd > 0) return Math.floor(amount / marketPerUsd);
  return null;
}

/** Whether a row needs a market rate at all (so the sweep only asks for the currencies it must). */
export function needsMarketRate(row: CommissionAmount): boolean {
  const cur = row.currency.toUpperCase();
  return cur !== "USD" && cur !== "CREDIT" && !(Number(row.fx_minor_per_usd) > 0);
}
