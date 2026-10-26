import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Saved bank accounts for a coin withdrawal (owner, 2026-10-26: Wallet setup) — the
 * member's EXISTING records, never a second bank-account system:
 *
 *   sub        the creator's saved, Paystack-verified SUB payout beneficiary (sub_payout_accounts)
 *   w:<id>     the bank of one of the member's own earlier Nigerian bank withdrawals
 *              (withdrawal_requests, Rewards and Frenz Coin alike — payout_method "paystack")
 *
 * The browser is only ever sent the bank, the holder name and the last four digits (the
 * rule sub_payout_accounts already keeps). A withdrawal names a saved account by its id and
 * the SERVER puts the full number back — after which the route runs exactly as before: the
 * bank confirms the holder, the PIN is checked, the database holds the coins.
 *
 * A withdrawal the bank sent back, or one that was rejected or reversed, is never offered.
 */

export interface SavedBank {
  id: string;
  bankName: string;
  last4: string;
  accountName: string | null;
}

export interface SavedBankDetails {
  bankCode: string;
  bankName: string;
  accountNumber: string;
}

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Never offer the account of a withdrawal that failed at the bank or was refused. */
const BAD_STATUS = new Set(["rejected", "reversed", "returned", "cancelled", "failed"]);

/** A Nigerian bank account as the withdrawal route accepts it, or null. Pure. */
export function bankFrom(raw: unknown): SavedBankDetails | null {
  const r = (raw ?? {}) as Row;
  const d = { bankCode: str(r.bankCode), bankName: str(r.bankName), accountNumber: str(r.accountNumber) };
  return /^\d{10}$/.test(d.accountNumber) && /^[0-9A-Za-z]{2,10}$/.test(d.bankCode) && d.bankName.length >= 2 ? d : null;
}

/** The member's saved accounts, newest first, one per bank + account number. Never throws. */
export async function listSavedBanks(userId: string, max = 5): Promise<SavedBank[]> {
  const db = createAdminClient();
  const out: SavedBank[] = [];
  const seen = new Set<string>();
  const add = (id: string, d: SavedBankDetails, accountName: string | null) => {
    const k = `${d.bankCode}:${d.accountNumber}`;
    if (seen.has(k) || out.length >= max) return;
    seen.add(k);
    out.push({ id, bankName: d.bankName, last4: d.accountNumber.slice(-4), accountName: accountName || null });
  };
  try {
    const [sub, past] = await Promise.all([
      db.from("sub_payout_accounts").select("bank_code, bank_name, account_number, account_name").eq("creator_id", userId).maybeSingle(),
      db.from("withdrawal_requests").select("id, status, payout_method, payout_details").eq("user_id", userId).eq("payout_method", "paystack").order("created_at", { ascending: false }).limit(20),
    ]);
    const s = sub.data as Row | null;
    const sd = s ? bankFrom({ bankCode: s.bank_code, bankName: s.bank_name, accountNumber: s.account_number }) : null;
    if (sd) add("sub", sd, str(s?.account_name));
    for (const w of (past.data ?? []) as Row[]) {
      if (BAD_STATUS.has(str(w.status))) continue;
      const d = bankFrom(w.payout_details);
      if (d) add(`w:${str(w.id)}`, d, str((w.payout_details as Row | null)?.accountName));
    }
  } catch {
    /* none offered — the member types the account, exactly as before */
  }
  return out;
}

/** The full details of ONE of this member's saved accounts, for the server only. Null when it is not theirs. */
export async function resolveSavedBank(userId: string, id: string): Promise<SavedBankDetails | null> {
  const db = createAdminClient();
  try {
    if (id === "sub") {
      const { data } = await db.from("sub_payout_accounts").select("bank_code, bank_name, account_number").eq("creator_id", userId).maybeSingle();
      const s = data as Row | null;
      return s ? bankFrom({ bankCode: s.bank_code, bankName: s.bank_name, accountNumber: s.account_number }) : null;
    }
    const wid = id.startsWith("w:") ? id.slice(2) : "";
    if (!UUID.test(wid)) return null;
    // 🔴 scoped to THIS member: another member's withdrawal id resolves to nothing
    const { data } = await db.from("withdrawal_requests").select("status, payout_method, payout_details").eq("id", wid).eq("user_id", userId).maybeSingle();
    const w = data as Row | null;
    if (!w || w.payout_method !== "paystack" || BAD_STATUS.has(str(w.status))) return null;
    return bankFrom(w.payout_details);
  } catch {
    return null;
  }
}
