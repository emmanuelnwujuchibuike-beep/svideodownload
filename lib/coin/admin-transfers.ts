import "server-only";

import { isUuid } from "@/lib/sub/guards";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Frenz Coin Part 6 — what an ADMINISTRATOR sees of coin transfers before correcting one: the transfer as the database
 * recorded it (amount, fee, total, when, who — by public handle and name), every correction already made to it (who,
 * what, why, when), and what is still correctable (the fee, if not refunded; sender credits up to the transfer amount).
 * READ-ONLY. Corrections go through POST /api/admin/wallet/coin-transfers/[id]/correct (0283 correct_coin_transfer),
 * which re-checks every limit itself — these figures only explain the choice.
 */

type Person = { id: string; handle: string | null; name: string | null };
export interface AdminCoinTransferCorrection {
  id: string;
  kind: "fee_refund" | "sender_credit";
  amountCents: number;
  reason: string;
  admin: Person;
  createdAt: string;
}
export interface AdminCoinTransfer {
  id: string;
  sender: Person;
  recipient: Person;
  amountCents: number;
  feeCents: number;
  totalCents: number;
  bracket: string;
  createdAt: string;
  corrections: AdminCoinTransferCorrection[];
  /** the fee can still be refunded (once per transfer, and only if there was a fee) */
  feeRefundable: boolean;
  /** sender credits may add up to the transfer amount, in total */
  creditRemainingCents: number;
}

const COLS = "id, sender_id, recipient_id, amount_cents, fee_cents, total_debit_cents, bracket, created_at";
type Row = { id: string; sender_id: string; recipient_id: string; amount_cents: number; fee_cents: number; total_debit_cents: number; bracket: string; created_at: string };
type CRow = { id: string; transfer_id: string; kind: "fee_refund" | "sender_credit"; amount_cents: number; reason: string; admin_id: string; created_at: string };

async function people(ids: string[]): Promise<Map<string, Person>> {
  const uniq = [...new Set(ids.filter(isUuid))];
  if (!uniq.length) return new Map();
  const { data } = await createAdminClient().from("profiles").select("id, handle, display_name").in("id", uniq);
  return new Map(((data ?? []) as { id: string; handle: string | null; display_name: string | null }[]).map((p) => [p.id, { id: p.id, handle: p.handle, name: p.display_name }]));
}

function shape(r: Row, corrections: CRow[], who: Map<string, Person>): AdminCoinTransfer {
  const p = (id: string): Person => who.get(id) ?? { id, handle: null, name: null };
  const mine = corrections.filter((c) => c.transfer_id === r.id);
  const credited = mine.filter((c) => c.kind === "sender_credit").reduce((a, c) => a + Number(c.amount_cents), 0);
  return {
    id: r.id,
    sender: p(r.sender_id),
    recipient: p(r.recipient_id),
    amountCents: Number(r.amount_cents),
    feeCents: Number(r.fee_cents),
    totalCents: Number(r.total_debit_cents),
    bracket: r.bracket,
    createdAt: r.created_at,
    corrections: mine.map((c) => ({ id: c.id, kind: c.kind, amountCents: Number(c.amount_cents), reason: c.reason, admin: p(c.admin_id), createdAt: c.created_at })),
    feeRefundable: Number(r.fee_cents) > 0 && !mine.some((c) => c.kind === "fee_refund"),
    creditRemainingCents: Math.max(0, Number(r.amount_cents) - credited),
  };
}

/** One transfer by id, or the most recent ones (newest first). null = the read failed. */
export async function adminCoinTransfers(opts: { id?: string | null; limit?: number } = {}): Promise<{ ok: true; items: AdminCoinTransfer[] } | { ok: false; reason: "pending_migration" | "error" }> {
  const db = createAdminClient();
  let q = db.from("coin_transfers").select(COLS);
  if (opts.id) q = q.eq("id", opts.id);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(opts.id ? 1 : Math.max(1, Math.min(100, opts.limit ?? 30)));
  if (error) return { ok: false, reason: /coin_transfers|schema cache|does not exist/i.test(error.message) ? "pending_migration" : "error" };
  const rows = (data ?? []) as Row[];
  if (!rows.length) return { ok: true, items: [] };
  const c = await db.from("coin_transfer_corrections").select("id, transfer_id, kind, amount_cents, reason, admin_id, created_at").in("transfer_id", rows.map((r) => r.id)).order("created_at", { ascending: true });
  // before 0283 there are no corrections to show — the transfers still are
  const corrections = c.error ? [] : ((c.data ?? []) as CRow[]);
  const who = await people([...rows.flatMap((r) => [r.sender_id, r.recipient_id]), ...corrections.map((x) => x.admin_id)]);
  return { ok: true, items: rows.map((r) => shape(r, corrections, who)) };
}
