import { PAYMENT_PURPOSES, type PaymentPurpose } from "@/lib/ai/credits/wallet-config";

/**
 * The payment purposes the admin payments view knows (pure). The routed purposes, plus Frenz Coin deposits (Part 4.1):
 * a purpose of the attempt ledger that is not routed — Flutterwave only — and so not in PAYMENT_PURPOSES (adding it
 * there would add it to the admin's per-market routing table).
 */
export type AdminPaymentPurpose = PaymentPurpose | "coin_deposit";
export const ADMIN_PAYMENT_PURPOSES: readonly AdminPaymentPurpose[] = [...PAYMENT_PURPOSES, "coin_deposit"];
