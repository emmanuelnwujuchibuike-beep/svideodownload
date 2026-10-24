/**
 * Payout references, one per withdrawal and rail (2026-10-24). The prefix says which provider sent a transfer, so
 * rejecting, settling and reconciling always ask THAT provider: Paystack `frenz_wd_<id>`, Flutterwave `frenz_fwd_<id>`.
 */
export const PAYSTACK_REF = (withdrawalId: string) => `frenz_wd_${withdrawalId.replace(/-/g, "")}`;
export const FLUTTERWAVE_REF = (withdrawalId: string) => `frenz_fwd_${withdrawalId.replace(/-/g, "")}`;
export const isFlutterwavePayoutRef = (r: string | null | undefined): r is string => !!r && r.startsWith("frenz_fwd_");
export const isPayoutRef = (r: string | null | undefined): r is string => !!r && (r.startsWith("frenz_wd_") || r.startsWith("frenz_fwd_"));
