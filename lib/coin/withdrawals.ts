import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Frenz Coin withdrawals — the reads (closeout). Requests go through lib/coin/server.ts requestCoinWithdrawal (the PIN,
 * 0283); payouts, provider outcomes, reconciliation and bank returns are the existing withdrawal rails
 * (lib/rewards/flutterwave-payouts.ts, paystack-payouts.ts, resolve_withdrawal / reverse_paid_withdrawal), which dispatch
 * a coin withdrawal to its own accounting (0279).
 */

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const last4 = (v: unknown) => (typeof v === "string" && v.length >= 4 ? v.slice(-4) : null);

export interface CoinWithdrawalView {
  id: string;
  status: string;
  grossCents: number;
  feeCents: number;
  netCents: number;
  payout: { currency: string; minor: number } | null;
  bank: { name: string | null; last4: string | null };
  createdAt: string;
  updatedAt: string | null;
}

const view = (r: Row): CoinWithdrawalView => {
  const d = (r.payout_details ?? {}) as Row;
  return {
    id: String(r.id),
    status: String(r.status),
    grossCents: n(r.gross_cents),
    feeCents: n(r.fee_cents),
    netCents: n(r.net_cents),
    payout: r.payout_minor ? { currency: String(r.payout_currency ?? "NGN"), minor: n(r.payout_minor) } : null,
    bank: { name: typeof d.bankName === "string" ? d.bankName : null, last4: last4(d.accountNumber) },
    createdAt: String(r.created_at),
    updatedAt: (r.updated_at as string | null) ?? null,
  };
};

const COLS = "id, user_id, status, gross_cents, fee_cents, net_cents, payout_currency, payout_minor, payout_details, payout_reference, created_at, updated_at";

/** The member's own coin withdrawals, newest first (the bank shown by name and last four digits only). */
export async function memberCoinWithdrawals(userId: string, limit = 20): Promise<CoinWithdrawalView[] | null> {
  const { data, error } = await createAdminClient().from("withdrawal_requests").select(COLS).eq("user_id", userId).eq("source", "coin").order("created_at", { ascending: false }).limit(Math.max(1, Math.min(50, limit)));
  if (error) return null;
  return ((data ?? []) as Row[]).map(view);
}

/** How the naira payout of a coin withdrawal was worked out (0283 payout_fx), recorded once before anything was sent. */
export interface CoinPayoutFx {
  source: "fixed" | "market" | null;
  /** fixed: kobo per USD */
  minorPerUsd: number | null;
  /** market: naira per USD */
  perUsd: number | null;
  provider: string | null;
  at: string | null;
}
export type AdminCoinWithdrawal = CoinWithdrawalView & { userId: string; reference: string | null; member: { handle: string | null; name: string | null }; payoutFx: CoinPayoutFx | null };

const fxOf = (v: unknown): CoinPayoutFx | null => {
  if (!v || typeof v !== "object") return null;
  const f = v as Row;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  return { source: f.source === "fixed" || f.source === "market" ? f.source : null, minorPerUsd: num(f.minorPerUsd), perUsd: num(f.perUsd), provider: typeof f.provider === "string" ? f.provider : null, at: typeof f.at === "string" ? f.at : null };
};

/**
 * For the admin: open coin withdrawals first, then recent ones, with the member (public handle and name), the payout
 * reference and — Part 6 — the recorded exchange-rate snapshot (payout_fx). Read-only.
 */
export async function adminCoinWithdrawals(limit = 100): Promise<{ open: AdminCoinWithdrawal[]; recent: AdminCoinWithdrawal[] } | null> {
  const db = createAdminClient();
  const cols = `${COLS}, payout_fx`;
  const [open, recent] = await Promise.all([
    db.from("withdrawal_requests").select(cols).eq("source", "coin").in("status", ["pending", "reviewing", "approved", "processing"]).order("created_at", { ascending: true }).limit(limit),
    db.from("withdrawal_requests").select(cols).eq("source", "coin").in("status", ["completed", "rejected", "cancelled", "reversed"]).order("updated_at", { ascending: false }).limit(limit),
  ]);
  if (open.error || recent.error) return null;
  const rows = [...((open.data ?? []) as unknown as Row[]), ...((recent.data ?? []) as unknown as Row[])];
  const ids = [...new Set(rows.map((r) => String(r.user_id)))];
  const people = ids.length ? await db.from("profiles").select("id, handle, display_name").in("id", ids) : { data: [] };
  const byId = new Map(((people.data ?? []) as { id: string; handle: string | null; display_name: string | null }[]).map((p) => [p.id, p]));
  const withUser = (r: Row): AdminCoinWithdrawal => {
    const p = byId.get(String(r.user_id));
    return { ...view(r), userId: String(r.user_id), reference: (r.payout_reference as string | null) ?? null, member: { handle: p?.handle ?? null, name: p?.display_name ?? null }, payoutFx: fxOf(r.payout_fx) };
  };
  return { open: ((open.data ?? []) as unknown as Row[]).map(withUser), recent: ((recent.data ?? []) as unknown as Row[]).map(withUser) };
}
