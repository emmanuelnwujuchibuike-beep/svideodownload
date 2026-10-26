import "server-only";

import { coinTransferFee, coinWithdrawalFee, type FrenzCoinConfig } from "@/lib/coin/config";
import { releaseDueCoinDeposits } from "@/lib/coin/deposits";
import { coinPinStatus, pinPepper } from "@/lib/coin/pin";
import { getWalletPrefs } from "@/lib/coin/wallet-prefs";
import { decodeSubCursor, encodeSubCursor, isUuid } from "@/lib/sub/guards";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ COIN — THE MEMBER'S WALLET SUMMARY AND HISTORY (Frenz Coin Part 4)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * What the wallet designs (design/frenz-coin-wallet-design.zip: Main, Deposit, Transfer, Receipt) need from the server,
 * and nothing more. Every read is the SESSION member's own rows, product `frenz_coin` only — never an AI-credit or SUB
 * row — through the service role, so no client query can widen it.
 *
 * Balances are the database's, read as stored (0279): available = balance − pending, total = balance + held. Nothing is
 * recomputed from the ledger here and nothing a browser sends changes them. Before reading, the member's due deposits are
 * released (release_due_coin_deposits: the database clock decides "due"); a failed release only means the coins show as
 * pending a little longer.
 *
 * History: the coin ledger, newest first, 20 a page (50 at most), keyset by (created_at, id). An entry carries its kind,
 * amount, status, time and — for a transfer — the other member's public handle and name. Never an admin's reason text,
 * a provider id, a fraud signal, another member's id or metadata.
 */

export interface CoinWalletSummary {
  enabled: boolean;
  currency: "USD";
  centsPerCoin: number;
  walletNumber: string | null;
  /** Wallet settings (2026-10-26): the member's own "open with the balance hidden" — the eye still toggles per visit */
  hideBalance: boolean;
  availableCents: number;
  pendingCents: number;
  heldCents: number;
  totalCents: number;
  pendingDeposits: { amountCents: number; settledAt: string; releaseAt: string; status: "held" | "disputed" }[];
  nextReleaseAt: string | null;
  deposits: { enabled: boolean; holdHours: number; minCents: number; maxCents: number };
  transfers: {
    enabled: boolean;
    /** Part 4.2: true only when transfers are on, the PIN service is configured and this member has a PIN that is not locked */
    canSend: boolean;
    blockedBy: "disabled" | "authorization_unavailable" | "pin_not_set" | "pin_locked" | null;
    pin: { set: boolean; lockedUntil: string | null };
    minCents: number;
    maxCents: number;
    dailyMaxCents: number;
    feeExamples: { amountCents: number; feeCents: number; totalCents: number }[];
    /** The admin's fee rules, so the transfer screen describes the fee it will be quoted (2026-10-26). */
    fee: { percentBp: number; lowThresholdCents: number; highThresholdCents: number; flatBelowCents: number; flatMidCents: number; flatAboveCents: number };
  };
  /** closeout: withdrawals — the fee is taken FROM the gross; payouts need an approved naira rate (an owner decision) */
  withdrawals: {
    enabled: boolean;
    percentBp: number;
    flatCents: number;
    minCents: number;
    maxCents: number;
    payoutRateApproved: boolean;
    example: { grossCents: number; feeCents: number; netCents: number };
  };
}

const n = (v: unknown) => Number(v ?? 0);

export async function coinWalletSummary(userId: string, config: FrenzCoinConfig): Promise<CoinWalletSummary | null> {
  await releaseDueCoinDeposits(userId, 50);
  const db = createAdminClient();
  const [bal, deps, acct, pin, prefs] = await Promise.all([
    db.from("ai_product_balances").select("balance_cents, pending_cents, held_cents").eq("user_id", userId).eq("product", "frenz_coin").maybeSingle(),
    db.from("coin_deposits").select("amount_cents, settled_at, release_at, status").eq("user_id", userId).in("status", ["held", "disputed"]).order("release_at", { ascending: true }).limit(20),
    db.from("wallet_accounts").select("account_number").eq("user_id", userId).maybeSingle(),
    pinPepper() ? coinPinStatus(userId) : Promise.resolve(null),
    getWalletPrefs(userId),
  ]);
  if (bal.error) return null;
  const r = bal.data as { balance_cents?: number; pending_cents?: number; held_cents?: number } | null;
  const b = n(r?.balance_cents), p = n(r?.pending_cents), h = n(r?.held_cents);
  const pendingDeposits = deps.error
    ? []
    : ((deps.data ?? []) as { amount_cents: number; settled_at: string; release_at: string; status: "held" | "disputed" }[]).map((d) => ({ amountCents: n(d.amount_cents), settledAt: d.settled_at, releaseAt: d.release_at, status: d.status }));
  const t = config.transfers;
  const on = config.enabled && t.enabled;
  const blockedBy: CoinWalletSummary["transfers"]["blockedBy"] = !on ? "disabled" : !pin ? "authorization_unavailable" : !pin.set ? "pin_not_set" : pin.lockedUntil ? "pin_locked" : null;
  return {
    enabled: config.enabled,
    currency: "USD",
    centsPerCoin: config.centsPerCoin,
    walletNumber: ((acct.data as { account_number?: string } | null)?.account_number ?? null) || null,
    hideBalance: prefs.hideBalance,
    availableCents: b - p,
    pendingCents: p,
    heldCents: h,
    totalCents: b + h,
    pendingDeposits,
    nextReleaseAt: pendingDeposits.find((d) => d.status === "held")?.releaseAt ?? null,
    deposits: { enabled: config.enabled && config.deposits.enabled, holdHours: config.deposits.holdHours, minCents: config.deposits.minCents, maxCents: config.deposits.maxCents },
    transfers: {
      enabled: on,
      canSend: blockedBy === null,
      blockedBy,
      pin: { set: !!pin?.set, lockedUntil: pin?.lockedUntil ?? null },
      minCents: t.minCents,
      maxCents: t.maxCents,
      dailyMaxCents: t.dailyMaxCents,
      feeExamples: [5_000, 25_000, 60_000].map((a) => {
        const f = coinTransferFee(a, t);
        return { amountCents: a, feeCents: f.feeCents, totalCents: f.totalDebitCents };
      }),
      fee: { percentBp: t.percentBp, lowThresholdCents: t.lowThresholdCents, highThresholdCents: t.highThresholdCents, flatBelowCents: t.flatBelowCents, flatMidCents: t.flatMidCents, flatAboveCents: t.flatAboveCents },
    },
    withdrawals: (() => {
      const wd = config.withdrawals;
      const ex = coinWithdrawalFee(10_000, wd);
      return { enabled: config.enabled && wd.enabled, percentBp: wd.percentBp, flatCents: wd.flatCents, minCents: wd.minCents, maxCents: wd.maxCents, payoutRateApproved: wd.payoutRateSource !== "none" && (wd.payoutRateSource !== "fixed" || !!wd.payoutMinorPerUsd), example: { grossCents: ex.grossCents, feeCents: ex.feeCents, netCents: ex.netCents } };
    })(),
  };
}

export type CoinEntryKind = "deposit" | "transfer_in" | "transfer_out" | "transfer_fee" | "withdrawal" | "withdrawal_reversal" | "reversal" | "refund" | "adjustment";
export type CoinEntryStatus = "pending" | "completed" | "processing" | "held" | "reversed" | "returned";

export interface CoinHistoryEntry {
  id: string;
  kind: CoinEntryKind;
  title: string;
  /** signed US cents: + in, − out */
  amountCents: number;
  status: CoinEntryStatus;
  at: string;
  /** a pending deposit's release time */
  releaseAt: string | null;
  /** groups a transfer's amount and fee rows */
  transferId: string | null;
  counterparty: { handle: string | null; name: string | null } | null;
}

const KINDS: readonly CoinEntryKind[] = ["deposit", "transfer_in", "transfer_out", "transfer_fee", "withdrawal", "withdrawal_reversal", "reversal", "refund", "adjustment"];
const PAGE = 20;
const MAX_PAGE = 50;

function statusOf(kind: CoinEntryKind, status: string): CoinEntryStatus {
  if (kind === "deposit") return status === "reserved" ? "pending" : status === "refunded" ? "reversed" : "completed";
  if (kind === "withdrawal") return status === "reserved" ? "processing" : status === "reversed" ? "returned" : "completed";
  if (kind === "reversal") return status === "reserved" ? "held" : status === "refunded" ? "returned" : "completed";
  if (kind === "adjustment") return status === "reserved" ? "pending" : "completed";
  return "completed";
}

function titleOf(kind: CoinEntryKind, who: string | null): string {
  switch (kind) {
    case "deposit":
      return "Deposit";
    case "transfer_in":
      return who ? `From ${who}` : "Received";
    case "transfer_out":
      return who ? `To ${who}` : "Sent";
    case "transfer_fee":
      return "Transfer fee";
    case "withdrawal":
      return "Withdrawal";
    case "withdrawal_reversal":
      return "Withdrawal returned";
    case "reversal":
      return "Deposit taken back";
    case "refund":
      return "Returned to your wallet";
    default:
      return "Balance correction";
  }
}

export type CoinHistoryPage = { ok: true; items: CoinHistoryEntry[]; next: string | null } | { ok: false; status: number; error: string };

export async function coinHistory(userId: string, opts: { cursor?: string | null; limit?: number | null } = {}): Promise<CoinHistoryPage> {
  const c = decodeSubCursor(opts.cursor);
  if (c === "invalid" || (c && (!c.id || !isUuid(c.id)))) return { ok: false, status: 400, error: "Bad cursor." };
  const size = Math.max(1, Math.min(MAX_PAGE, Math.floor(Number(opts.limit ?? PAGE)) || PAGE));
  const db = createAdminClient();
  let q = db.from("ai_product_ledger").select("id, kind, status, delta_cents, created_at, metadata").eq("user_id", userId).eq("product", "frenz_coin");
  if (c?.id) q = q.or(`created_at.lt."${c.at}",and(created_at.eq."${c.at}",id.lt.${c.id})`);
  const { data, error } = await q.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(size + 1);
  if (error) return { ok: false, status: 503, error: "Couldn't load your history." };
  const rows = ((data ?? []) as { id: string; kind: string; status: string; delta_cents: number; created_at: string; metadata: Record<string, unknown> | null }[]).slice(0, size + 1);
  const page = rows.slice(0, size);
  // the other member of a transfer: public handle and name only
  const other = (r: (typeof page)[number]) => {
    const m = r.metadata ?? {};
    const id = r.kind === "transfer_in" ? m.sender_id : r.kind === "transfer_out" ? m.recipient_id : null;
    return typeof id === "string" && isUuid(id) ? id : null;
  };
  const ids = [...new Set(page.map(other).filter((x): x is string => !!x))];
  const people = ids.length ? await db.from("profiles").select("id, handle, display_name").in("id", ids) : { data: [] };
  const byId = new Map(((people.data ?? []) as { id: string; handle: string | null; display_name: string | null }[]).map((p) => [p.id, p]));
  const last = page[page.length - 1];
  return {
    ok: true,
    items: page.map((r) => {
      const kind = (KINDS as readonly string[]).includes(r.kind) ? (r.kind as CoinEntryKind) : "adjustment";
      const p = (() => {
        const id = other(r);
        return id ? byId.get(id) : undefined;
      })();
      const who = p ? p.display_name || (p.handle ? `@${p.handle}` : null) : null;
      const m = r.metadata ?? {};
      const status = statusOf(kind, r.status);
      return {
        id: r.id,
        kind,
        title: titleOf(kind, who),
        amountCents: n(r.delta_cents),
        status,
        at: r.created_at,
        releaseAt: kind === "deposit" && status === "pending" && typeof m.release_at === "string" ? m.release_at : null,
        transferId: typeof m.transfer_id === "string" && isUuid(m.transfer_id) ? m.transfer_id : null,
        counterparty: p ? { handle: p.handle ?? null, name: p.display_name ?? null } : null,
      };
    }),
    next: rows.length > size && last ? encodeSubCursor(last.created_at, last.id) : null,
  };
}
