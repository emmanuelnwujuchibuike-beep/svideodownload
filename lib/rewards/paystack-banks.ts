import "server-only";

import { paystackRequest } from "@/lib/paystack/paystack";

/** Paystack bank lookups for payouts: the bank list and the account-name check (lib/rewards/paystack-payouts.ts). */

export interface Bank {
  name: string;
  code: string;
}

let bankCache: { at: number; banks: Bank[] } | null = null;

/** Nigerian banks Paystack can pay into. Cached for a day: the list changes rarely. */
export async function listBanks(): Promise<Bank[]> {
  if (bankCache && Date.now() - bankCache.at < 86_400_000) return bankCache.banks;
  const r = await paystackRequest<{ data: { name: string; code: string; active?: boolean; is_deleted?: boolean }[] }>("/bank?country=nigeria&currency=NGN&perPage=200");
  const banks = (r.data ?? []).filter((b) => b.active !== false && !b.is_deleted).map((b) => ({ name: b.name, code: b.code }));
  bankCache = { at: Date.now(), banks };
  return banks;
}

/** The account holder's name, from Paystack, or null if the number and bank don't match an account. */
export async function resolveAccount(accountNumber: string, bankCode: string): Promise<string | null> {
  if (!/^\d{10}$/.test(accountNumber) || !/^[0-9A-Za-z]{2,10}$/.test(bankCode)) return null;
  try {
    const r = await paystackRequest<{ data: { account_name: string } }>(`/bank/resolve?account_number=${accountNumber}&bank_code=${encodeURIComponent(bankCode)}`);
    return r.data?.account_name?.trim() || null;
  } catch {
    return null;
  }
}

/** Kobo for a USD amount at a NGN-per-USD rate, rounded down. */
export function koboFor(usdCents: number, ngnPerUsd: number): number {
  return Math.max(0, Math.floor(usdCents * ngnPerUsd));
}
