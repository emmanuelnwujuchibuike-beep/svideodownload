import type { CoinWithdrawalRules } from "./config";

/**
 * What a coin withdrawal pays out in naira, shown on the member's review step BEFORE they
 * confirm (owner, 2026-10-26: "show users the effective rate and applicable fees before
 * confirmation"). Worked out on the server, from the admin's audited settings.
 *
 *   fixed   the admin's approved rate. The database fixes this exact naira amount on the
 *           withdrawal when it is requested (0279 request_coin_withdrawal: floor(net × kobo
 *           per USD / 100), the same integer rule as below), so `exact` is true.
 *   market  the live market rate, no markup. It is read again and RECORDED when the payout is
 *           sent (lib/rewards/payout-quote.ts), so this is an estimate: `exact` is false.
 *
 * Never a promise about the provider's own settlement: Flutterwave / Paystack pay the naira
 * amount recorded on the withdrawal, and their charges are Frenz's, not the member's.
 */
export interface PayoutPreview {
  currency: "NGN";
  source: "fixed" | "market";
  /** naira per 1 US dollar (1 Frenz Coin), as a decimal for display */
  nairaPerUsd: number;
  /** the payout in kobo (naira × 100) */
  estimatedMinor: number;
  /** true: this exact amount is fixed on the request. false: re-read and fixed at payout. */
  exact: boolean;
}

/** Pure. `marketNairaPerUsd` is the live rate when the source is "market" (null = unavailable). */
export function payoutPreview(netCents: number, w: Pick<CoinWithdrawalRules, "payoutRateSource" | "payoutMinorPerUsd">, marketNairaPerUsd: number | null): PayoutPreview | null {
  if (!(netCents > 0)) return null;
  if (w.payoutRateSource === "fixed") {
    if (!w.payoutMinorPerUsd || w.payoutMinorPerUsd <= 0) return null;
    const minor = Number((BigInt(Math.trunc(netCents)) * BigInt(w.payoutMinorPerUsd)) / 100n);
    return { currency: "NGN", source: "fixed", nairaPerUsd: w.payoutMinorPerUsd / 100, estimatedMinor: minor, exact: true };
  }
  if (w.payoutRateSource === "market") {
    if (!marketNairaPerUsd || !(marketNairaPerUsd > 0)) return null;
    // the payout rail's own rule, koboFor (lib/rewards/paystack-banks.ts): floor(cents × naira per USD) — whole kobo
    return { currency: "NGN", source: "market", nairaPerUsd: marketNairaPerUsd, estimatedMinor: Math.max(0, Math.floor(netCents * marketNairaPerUsd)), exact: false };
  }
  return null;
}
