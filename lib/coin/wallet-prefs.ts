import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import type { CoinNotificationType } from "./notify";

/**
 * The member's wallet preferences (owner, 2026-10-26: Wallet setup), stored in
 * notification_settings.wallet_prefs (migration 0286).
 *
 * The three notification switches control PUSH alerts only. Every transaction is still
 * recorded in the member's activity and emailed as a receipt (Frenz Coin Part 5: every
 * transaction is emailed), and PIN / security alerts are never optional.
 *
 * Fails OPEN to the defaults: a read that fails (or a deployment without 0286) means
 * "everything on, balance shown" — the behaviour before this existed.
 */
export interface WalletPrefs {
  notifyReceived: boolean;
  notifySent: boolean;
  notifyWithdrawals: boolean;
  hideBalance: boolean;
}

export const DEFAULT_WALLET_PREFS: WalletPrefs = { notifyReceived: true, notifySent: true, notifyWithdrawals: true, hideBalance: false };

const KEYS = Object.keys(DEFAULT_WALLET_PREFS) as (keyof WalletPrefs)[];

/** A stored value, read safely: only booleans count, anything else is the default. */
export function normalizeWalletPrefs(raw: unknown): WalletPrefs {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_WALLET_PREFS };
  for (const k of KEYS) if (typeof r[k] === "boolean") out[k] = r[k] as boolean;
  return out;
}

/**
 * Does this member want a PUSH for this coin notification? Money in (a transfer received,
 * a deposit ready), money out (a transfer sent), withdrawal updates. Security is always yes.
 */
export function walletPushAllowed(type: CoinNotificationType, prefs: WalletPrefs): boolean {
  if (type === "coin_transfer_received" || type === "coin_deposit_update") return prefs.notifyReceived;
  if (type === "coin_transfer_sent") return prefs.notifySent;
  if (type === "coin_withdrawal_update") return prefs.notifyWithdrawals;
  return true;
}

export async function getWalletPrefs(userId: string): Promise<WalletPrefs> {
  try {
    const { data, error } = await createAdminClient().from("notification_settings").select("wallet_prefs").eq("user_id", userId).maybeSingle();
    if (error) return { ...DEFAULT_WALLET_PREFS };
    return normalizeWalletPrefs((data as { wallet_prefs?: unknown } | null)?.wallet_prefs);
  } catch {
    return { ...DEFAULT_WALLET_PREFS };
  }
}

/** Merge a patch into the member's preferences. Only the four known booleans are ever written. */
export async function setWalletPrefs(userId: string, patch: Partial<WalletPrefs>): Promise<{ ok: true; prefs: WalletPrefs } | { ok: false }> {
  const current = await getWalletPrefs(userId);
  const next = { ...current };
  for (const k of KEYS) if (typeof patch[k] === "boolean") next[k] = patch[k] as boolean;
  // upsert with only these two columns: an existing row keeps every other setting; a new row gets the table defaults
  const { error } = await createAdminClient().from("notification_settings").upsert({ user_id: userId, wallet_prefs: next }, { onConflict: "user_id" });
  if (error) {
    console.warn("[coin/wallet-prefs] save failed", { code: error.code });
    return { ok: false };
  }
  return { ok: true, prefs: next };
}
