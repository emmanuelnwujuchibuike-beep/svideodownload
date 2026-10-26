import { randomUUID } from "node:crypto";

/**
 * Merchant references for Flutterwave checkouts (Part 2). One prefix per purpose,
 * each with `_fw_` so a reference names its provider by itself — a webhook, a return
 * page or a reconcile can never send a Flutterwave reference down the Paystack path or
 * the other way round. Paystack's references are unchanged (`frenz_cr_topup_…`,
 * `frenz_sub_…`, `frenz_vf_…`, `frenz_ad_…`).
 *
 * Flutterwave requires `tx_ref` to be unique per transaction; these are a prefix plus a
 * random UUID (hex, no dashes for SUB/verification, matching their existing shapes), at
 * most 54 characters, letters/digits/underscore/dash only.
 */
export const FLUTTERWAVE_REFERENCE_PREFIX = {
  wallet_topup: "frenz_cr_topup_fw_",
  sub_purchase: "frenz_sub_fw_",
  verification: "frenz_vf_fw_",
  ad_campaign: "frenz_ad_fw_",
  // 2026-10-23: an AI plan's FIRST charge on a Flutterwave payment plan (lib/ai/credits/plan-attempts.ts)
  ai_subscription: "frenz_ai_plan_fw_",
  // 2026-10-23: a Pro / Business site plan's FIRST charge on a Flutterwave payment plan
  site_subscription: "frenz_site_fw_",
  // Frenz Coin Part 4 (0280): a Frenz Coin deposit — settled only by lib/coin/deposits.ts, never as an AI-credit top-up
  coin_deposit: "frenz_coin_dep_fw_",
} as const;

export type FlutterwaveReferencePurpose = keyof typeof FLUTTERWAVE_REFERENCE_PREFIX;

export function newFlutterwaveReference(purpose: FlutterwaveReferencePurpose): string {
  const id = randomUUID();
  return `${FLUTTERWAVE_REFERENCE_PREFIX[purpose]}${purpose === "sub_purchase" || purpose === "verification" ? id.replace(/-/g, "") : id}`;
}

const SHAPES: Record<FlutterwaveReferencePurpose, RegExp> = {
  wallet_topup: /^frenz_cr_topup_fw_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  sub_purchase: /^frenz_sub_fw_[0-9a-f]{32}$/,
  verification: /^frenz_vf_fw_[0-9a-f]{32}$/,
  ad_campaign: /^frenz_ad_fw_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  ai_subscription: /^frenz_ai_plan_fw_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  site_subscription: /^frenz_site_fw_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  coin_deposit: /^frenz_coin_dep_fw_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
};

/** Which purpose a Flutterwave reference we minted is for — null for anything else (a Paystack reference, a forgery). */
export function flutterwaveReferencePurpose(reference: unknown): FlutterwaveReferencePurpose | null {
  if (typeof reference !== "string") return null;
  for (const p of Object.keys(SHAPES) as FlutterwaveReferencePurpose[]) if (SHAPES[p].test(reference)) return p;
  return null;
}

export const isFlutterwaveReference = (reference: unknown): reference is string => flutterwaveReferencePurpose(reference) !== null;
