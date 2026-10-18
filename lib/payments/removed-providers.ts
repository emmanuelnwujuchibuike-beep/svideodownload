/**
 * Payment providers that were REMOVED, and how their leftover references are recognised.
 *
 * Bachs (bachs.io) was removed on 2026-10-17 (owner). Its rows stay in the database exactly as
 * they were written — `ai_topup_attempts.provider = 'bachs'`, `ad_campaigns.payment_method =
 * 'bachs'` — because they are financial history: never relabelled, never deleted, never settled
 * or released by code. A reference it minted (`frenz_bachs_topup_…`, `frenz_bachs_plan_…`,
 * `frenz_bachs_ad_…`) must not fall through to the Paystack verify path either: Paystack would
 * answer "not found" and a historical attempt could be marked failed. So the verify routes stop
 * at this check and answer "pending" without asking anyone. A person reconciles those rows in
 * the Bachs dashboard (docs/PAYMENTS.md "Bachs removed").
 */
export const REMOVED_PROVIDER_REFERENCE_PREFIXES = ["frenz_bachs_"] as const;

export function isRemovedProviderReference(reference: string): boolean {
  return REMOVED_PROVIDER_REFERENCE_PREFIXES.some((p) => reference.startsWith(p));
}
