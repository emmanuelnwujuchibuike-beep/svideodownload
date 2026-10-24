/**
 * The instant-payout gate for Exclusive withdrawals (owner, 2026-10-24: "make sure the withdrawal is fully secured and
 * gated, for fraud prevention and hacks"). Pure, so every rule is tested.
 *
 * The withdrawal itself is always checked by request_sub_withdrawal (balance lock, minimum, one open withdrawal,
 * replay key, suspension, qualification) and the account holder is named by the bank lookup. This decides only
 * whether it may LEAVE AT ONCE or must wait for an admin. A stolen session's usual move — add a new bank account
 * and empty the balance — fails every rule below, and the real owner is emailed about the new account.
 *
 *   new_account     the bank account was verified less than `newAccountHoldHours` ago (or the request names an
 *                   account that is not the saved one)
 *   over_single     this withdrawal is above `autoPayoutMaxCents`
 *   over_daily      with the last 24 hours' instant payouts it goes above `autoPayoutDailyMaxCents`
 *   shared_account  the same bank account is the payout account of another creator (a mule account)
 *   email           the email address is not confirmed
 *   unknown         a fact could not be read — fail CLOSED: an admin looks
 */

export type PayoutHoldReason = "new_account" | "over_single" | "over_daily" | "shared_account" | "email" | "unknown";

export interface PayoutRiskFacts {
  amountCents: number;
  /** when the payout account was verified; null = the request is not to the saved, verified account */
  accountVerifiedAt: string | null;
  /** instant payouts (approved / processing / completed) in the last 24 hours, excluding this one; null = unknown */
  last24hCents: number | null;
  /** another creator has the same bank account; null = unknown */
  sharedAccount: boolean | null;
  /** null = unknown */
  emailConfirmed: boolean | null;
}

export interface PayoutRiskRules {
  autoPayoutMaxCents: number;
  autoPayoutDailyMaxCents: number;
  newAccountHoldHours: number;
}

export const HOLD_REASON_LABEL: Record<PayoutHoldReason, string> = {
  new_account: "new or changed bank account",
  over_single: "above the instant-payout limit",
  over_daily: "above the 24-hour instant-payout limit",
  shared_account: "bank account used by another creator",
  email: "email not confirmed",
  unknown: "a safety check couldn't be completed",
};

export function payoutHoldReasons(f: PayoutRiskFacts, r: PayoutRiskRules, now: number): PayoutHoldReason[] {
  const out: PayoutHoldReason[] = [];
  const verified = f.accountVerifiedAt ? Date.parse(f.accountVerifiedAt) : NaN;
  if (!Number.isFinite(verified) || now - verified < r.newAccountHoldHours * 3_600_000) out.push("new_account");
  if (f.amountCents > r.autoPayoutMaxCents) out.push("over_single");
  if (f.last24hCents !== null && f.last24hCents + f.amountCents > r.autoPayoutDailyMaxCents) out.push("over_daily");
  if (f.sharedAccount === true) out.push("shared_account");
  if (f.emailConfirmed === false) out.push("email");
  if (f.last24hCents === null || f.sharedAccount === null || f.emailConfirmed === null) out.push("unknown");
  return out;
}
