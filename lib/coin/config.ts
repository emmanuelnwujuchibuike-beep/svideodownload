import { PAYOUT_ROUTES, type PayoutRoute } from "@/lib/rewards/payout-rail";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ COIN — CONFIGURATION AND FEE ARITHMETIC (Frenz Coin Part 3, migration 0279)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Frenz Coin is a SEPARATE wallet product (`frenz_coin` in ai_product_balances / ai_product_ledger), accounted in
 * integer US cents. It never converts, replaces or reads AI Credits. This module is pure: the admin's settings (the
 * `frenzCoin` section of the landing settings row, audited and versioned like every money setting) and the fee
 * formulas. The DATABASE re-computes every fee from the rules it is handed (coin_transfer_fee / coin_withdrawal_fee
 * in 0279) and stores the rules on each operation, so a completed transaction is never re-priced by a later change.
 *
 * ── Transfer fee (owner, 2026-10-25) ────────────────────────────────────────
 * The SENDER pays it on top of the amount; the recipient receives exactly the amount.
 *
 *   amount < $100              10% + $1
 *   $100 ≤ amount ≤ $500       10% + $0
 *   amount > $500              10% + $5
 *
 *   percentage part = ceil(amount × percentBp / 10 000)   — rounded UP to the cent (never a fraction, never below
 *                                                            the rate), the same policy as AI-credit transfer fees
 *   flat part       = the bracket's flat fee
 *
 * ── Withdrawal fee ──────────────────────────────────────────────────────────
 * Its own setting (default 6%, no flat fee), NOT the AI-credit or SUB withdrawal fees and not their 0258 flat tiers.
 * Taken FROM the amount withdrawn: gross = the amount, fee = ceil(gross × percentBp / 10 000) + flatCents,
 * net (paid out) = gross − fee. (Owner decision to confirm: on top or taken from the amount.)
 */

export interface CoinTransferRules {
  enabled: boolean;
  percentBp: number;
  /** below this amount the low flat fee applies; from it, up to and INCLUDING `highThresholdCents`, the middle one */
  lowThresholdCents: number;
  highThresholdCents: number;
  flatBelowCents: number;
  flatMidCents: number;
  flatAboveCents: number;
  minCents: number;
  maxCents: number;
  /** the rolling 24-hour total a member may send (amounts, not fees) */
  dailyMaxCents: number;
}

export interface CoinWithdrawalRules {
  enabled: boolean;
  percentBp: number;
  flatCents: number;
  minCents: number;
  maxCents: number;
  maxPerDay: number;
  /** the rolling 30-day total of gross withdrawals */
  maxMonthCents: number;
  /** the admin-approved rewards qualification (0191). Off by default: coins are deposited money, not rewards. */
  requireQualification: boolean;
  requireEmailConfirmed: boolean;
  /** what a Nigerian bank payout is paid in, and the rate used — null = not configured, payouts stay closed */
  payoutCurrency: "NGN";
  payoutMinorPerUsd: number | null;
  /**
   * Closeout: WHICH naira rate a coin payout uses — an owner decision, never assumed. "none" (default) = no coin payout
   * can be sent; "fixed" = payoutMinorPerUsd; "market" = the live market rate the AI-credit and SUB payouts already use,
   * with no markup. The amount and rate are recorded on the withdrawal once, before anything is sent (0283).
   */
  payoutRateSource: "none" | "fixed" | "market";
}

export interface CoinPinPolicy {
  maxAttempts: number;
  lockMinutes: number;
  resetTtlMinutes: number;
  resetMaxPerHour: number;
  resetCodeMaxAttempts: number;
}

export interface FrenzCoinConfig {
  enabled: boolean;
  /** accounting unit: integer US cents. A coin is displayed as `centsPerCoin` cents (1 coin = $1 by default). */
  currency: "USD";
  centsPerCoin: number;
  transfers: CoinTransferRules;
  withdrawals: CoinWithdrawalRules;
  /**
   * Deposits (Part 4, 0280): a settled deposit is PENDING for `holdHours` (by the database clock) before it can be spent.
   * 0284 (owner, 2026-10-25: "deposit hold should be like 1hr or configurable by admin"): 0 to 2160 hours, 1 by default.
   * Off by default; the master switch must be on too.
   */
  deposits: { enabled: boolean; holdHours: number; minCents: number; maxCents: number };
  /**
   * The transaction PIN (Part 4.2, 0282): attempts before a lock, the first lock (it doubles, at most 24 hours), and the
   * emailed reset code. The database clamps every number again (coin_pin_setting).
   */
  pin: CoinPinPolicy;
  /**
   * Part 5 (owner, 2026-10-25): how the ADMINS hear about each coin transfer and withdrawal, with the fee Frenz earned
   * on it — push to every admin device, email to the alert address, both, or off. Deposits are already announced to
   * the admins by the funding alerts (lib/admin/funding-alerts.ts). A notification setting: it prices nothing, so it
   * does not bump the version.
   */
  adminAlerts: CoinAdminAlerts;
  /**
   * Which rail pays a Frenz Coin withdrawal — one clean path, the admin's (owner, 2026-10-29; lib/rewards/payout-rail.ts
   * PAYOUT_ROUTES): `flutterwave` = Flutterwave ONLY (the default), `paystack` = Paystack only,
   * `flutterwave_paystack_backup` = Flutterwave with Paystack as the backup, and `by_country` = the 2026-10-27 rule
   * (Nigeria, Ghana, South Africa, Kenya by Paystack, beyond by Flutterwave) — each withdrawal on exactly one rail, no
   * backup. Prices nothing, so it does not bump the version.
   */
  payoutProvider: CoinPayoutProvider;
  version: number;
  updatedAt: string | null;
}

export type CoinAdminAlerts = "both" | "push" | "email" | "off";
export const COIN_ADMIN_ALERTS: readonly CoinAdminAlerts[] = ["both", "push", "email", "off"];

export type CoinPayoutProvider = PayoutRoute | "by_country";
export const COIN_PAYOUT_PROVIDERS: readonly CoinPayoutProvider[] = [...PAYOUT_ROUTES, "by_country"];

export const COIN_DEFAULTS: FrenzCoinConfig = {
  enabled: false,
  currency: "USD",
  centsPerCoin: 100,
  transfers: { enabled: true, percentBp: 1_000, lowThresholdCents: 10_000, highThresholdCents: 50_000, flatBelowCents: 100, flatMidCents: 0, flatAboveCents: 500, minCents: 100, maxCents: 500_000, dailyMaxCents: 1_000_000 },
  withdrawals: { enabled: true, percentBp: 600, flatCents: 0, minCents: 500, maxCents: 500_000, maxPerDay: 1, maxMonthCents: 2_000_000, requireQualification: false, requireEmailConfirmed: true, payoutCurrency: "NGN", payoutMinorPerUsd: null, payoutRateSource: "none" },
  deposits: { enabled: false, holdHours: 1, minCents: 100, maxCents: 500_000 },
  pin: { maxAttempts: 5, lockMinutes: 15, resetTtlMinutes: 10, resetMaxPerHour: 3, resetCodeMaxAttempts: 5 },
  adminAlerts: "both",
  payoutProvider: "flutterwave",
  version: 1,
  updatedAt: null,
};

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const int = (v: unknown, d: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
/** The same bounds the database enforces (0279 coin_rules_ok): a rule set outside them is refused there. */
export const COIN_BOUNDS = { maxBp: 5_000, maxCents: 100_000_000, maxFlatCents: 100_000, maxPerDay: 100, minHoldHours: 0, maxHoldHours: 2_160 } as const;

export function normalizeCoinConfig(raw: unknown): FrenzCoinConfig {
  const r = isRecord(raw) ? raw : {};
  const d = COIN_DEFAULTS;
  const t = isRecord(r.transfers) ? r.transfers : {};
  const w = isRecord(r.withdrawals) ? r.withdrawals : {};
  const dep = isRecord(r.deposits) ? r.deposits : {};
  const pin = isRecord(r.pin) ? r.pin : {};
  const B = COIN_BOUNDS;
  const lowThresholdCents = int(t.lowThresholdCents, d.transfers.lowThresholdCents, 1, B.maxCents);
  const tMin = int(t.minCents, d.transfers.minCents, 1, B.maxCents);
  const wMin = int(w.minCents, d.withdrawals.minCents, 1, B.maxCents);
  const depMin = int(dep.minCents, d.deposits.minCents, 1, B.maxCents);
  const rate = w.payoutMinorPerUsd === null ? null : typeof w.payoutMinorPerUsd === "number" && Number.isSafeInteger(w.payoutMinorPerUsd) && w.payoutMinorPerUsd > 0 ? w.payoutMinorPerUsd : d.withdrawals.payoutMinorPerUsd;
  return {
    enabled: bool(r.enabled, d.enabled),
    currency: "USD",
    centsPerCoin: int(r.centsPerCoin, d.centsPerCoin, 1, 100_000),
    transfers: {
      enabled: bool(t.enabled, d.transfers.enabled),
      percentBp: int(t.percentBp, d.transfers.percentBp, 0, B.maxBp),
      lowThresholdCents,
      highThresholdCents: Math.max(lowThresholdCents, int(t.highThresholdCents, d.transfers.highThresholdCents, 1, B.maxCents)),
      flatBelowCents: int(t.flatBelowCents, d.transfers.flatBelowCents, 0, B.maxFlatCents),
      flatMidCents: int(t.flatMidCents, d.transfers.flatMidCents, 0, B.maxFlatCents),
      flatAboveCents: int(t.flatAboveCents, d.transfers.flatAboveCents, 0, B.maxFlatCents),
      minCents: tMin,
      maxCents: Math.max(tMin, int(t.maxCents, d.transfers.maxCents, 1, B.maxCents)),
      dailyMaxCents: int(t.dailyMaxCents, d.transfers.dailyMaxCents, 1, B.maxCents),
    },
    withdrawals: {
      enabled: bool(w.enabled, d.withdrawals.enabled),
      percentBp: int(w.percentBp, d.withdrawals.percentBp, 0, B.maxBp),
      flatCents: int(w.flatCents, d.withdrawals.flatCents, 0, B.maxFlatCents),
      minCents: wMin,
      maxCents: Math.max(wMin, int(w.maxCents, d.withdrawals.maxCents, 1, B.maxCents)),
      maxPerDay: int(w.maxPerDay, d.withdrawals.maxPerDay, 1, B.maxPerDay),
      maxMonthCents: int(w.maxMonthCents, d.withdrawals.maxMonthCents, 1, B.maxCents),
      requireQualification: bool(w.requireQualification, d.withdrawals.requireQualification),
      requireEmailConfirmed: bool(w.requireEmailConfirmed, d.withdrawals.requireEmailConfirmed),
      payoutCurrency: "NGN",
      payoutMinorPerUsd: rate,
      payoutRateSource: w.payoutRateSource === "fixed" || w.payoutRateSource === "market" ? w.payoutRateSource : "none",
    },
    deposits: {
      enabled: bool(dep.enabled, d.deposits.enabled),
      // 0284: the admin's hold, 0 to 2160 hours (the database clamps the same bounds - coin_deposit_rules_ok)
      holdHours: int(dep.holdHours, d.deposits.holdHours, COIN_BOUNDS.minHoldHours, COIN_BOUNDS.maxHoldHours),
      minCents: depMin,
      maxCents: Math.max(depMin, int(dep.maxCents, d.deposits.maxCents, 1, B.maxCents)),
    },
    // the same bounds as 0282 coin_pin_setting
    pin: {
      maxAttempts: int(pin.maxAttempts, d.pin.maxAttempts, 3, 10),
      lockMinutes: int(pin.lockMinutes, d.pin.lockMinutes, 5, 1440),
      resetTtlMinutes: int(pin.resetTtlMinutes, d.pin.resetTtlMinutes, 5, 30),
      resetMaxPerHour: int(pin.resetMaxPerHour, d.pin.resetMaxPerHour, 1, 10),
      resetCodeMaxAttempts: int(pin.resetCodeMaxAttempts, d.pin.resetCodeMaxAttempts, 3, 10),
    },
    adminAlerts: (COIN_ADMIN_ALERTS as readonly unknown[]).includes(r.adminAlerts) ? (r.adminAlerts as CoinAdminAlerts) : d.adminAlerts,
    payoutProvider: (COIN_PAYOUT_PROVIDERS as readonly unknown[]).includes(r.payoutProvider) ? (r.payoutProvider as CoinPayoutProvider) : d.payoutProvider,
    version: int(r.version, d.version, 1, Number.MAX_SAFE_INTEGER),
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null,
  };
}

/** The version bumps when anything that moves or prices money changed (stamped on every operation's snapshot). */
export function versionCoinConfig(previous: FrenzCoinConfig, next: FrenzCoinConfig, now: Date = new Date()): FrenzCoinConfig {
  const fp = (c: FrenzCoinConfig) => JSON.stringify({ e: c.enabled, c: c.currency, k: c.centsPerCoin, t: c.transfers, w: c.withdrawals, d: c.deposits, p: c.pin });
  if (fp(previous) === fp(next)) return { ...next, version: previous.version, updatedAt: previous.updatedAt };
  return { ...next, version: previous.version + 1, updatedAt: now.toISOString() };
}

/** ceil(amount × bp / 10 000) in integers — exact for any safe amount (no floating point). */
export function percentOfCeil(amountCents: number, bp: number): number {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || !Number.isSafeInteger(bp) || bp <= 0) return 0;
  const n = BigInt(amountCents) * BigInt(bp);
  return Number((n + 9_999n) / 10_000n);
}

export interface CoinTransferFee {
  percentCents: number;
  flatCents: number;
  feeCents: number;
  totalDebitCents: number;
  bracket: "below" | "mid" | "above";
}

/** The transfer fee for `amountCents` under `t` — the same formula as 0279 coin_transfer_fee. */
export function coinTransferFee(amountCents: number, t: Pick<CoinTransferRules, "percentBp" | "lowThresholdCents" | "highThresholdCents" | "flatBelowCents" | "flatMidCents" | "flatAboveCents">): CoinTransferFee {
  const bracket = amountCents < t.lowThresholdCents ? "below" : amountCents <= t.highThresholdCents ? "mid" : "above";
  const flatCents = bracket === "below" ? t.flatBelowCents : bracket === "mid" ? t.flatMidCents : t.flatAboveCents;
  const percentCents = percentOfCeil(amountCents, t.percentBp);
  return { percentCents, flatCents, feeCents: percentCents + flatCents, totalDebitCents: amountCents + percentCents + flatCents, bracket };
}

export interface CoinWithdrawalFee {
  grossCents: number;
  percentCents: number;
  flatCents: number;
  feeCents: number;
  netCents: number;
}

/** The withdrawal fee, taken from the amount — the same formula as 0279 coin_withdrawal_fee. */
export function coinWithdrawalFee(grossCents: number, w: Pick<CoinWithdrawalRules, "percentBp" | "flatCents">): CoinWithdrawalFee {
  const percentCents = percentOfCeil(grossCents, w.percentBp);
  const feeCents = percentCents + w.flatCents;
  return { grossCents, percentCents, flatCents: w.flatCents, feeCents, netCents: grossCents - feeCents };
}

/** The rules handed to the database for one transfer — validated there, and stored on the transfer as its snapshot. */
export function transferRulesForDb(c: FrenzCoinConfig) {
  // the spread FIRST: the master switch must win over the section's own `enabled`
  return { ...c.transfers, enabled: c.enabled && c.transfers.enabled, version: c.version };
}

/** The rules handed to the database for one withdrawal request (and stored on it). */
export function withdrawalRulesForDb(c: FrenzCoinConfig) {
  // the database fixes a naira amount at request time from payoutMinorPerUsd — only when that IS the chosen source
  const fixed = c.withdrawals.payoutRateSource === "fixed" ? c.withdrawals.payoutMinorPerUsd : null;
  return { ...c.withdrawals, payoutMinorPerUsd: fixed, enabled: c.enabled && c.withdrawals.enabled, version: c.version };
}

/** The rules a deposit checkout is opened under (begin_coin_deposit validates them and stores them on the attempt). */
export function depositRulesForDb(c: FrenzCoinConfig) {
  return { ...c.deposits, enabled: c.enabled && c.deposits.enabled, version: c.version };
}
