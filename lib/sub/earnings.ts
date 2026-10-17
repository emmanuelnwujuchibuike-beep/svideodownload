import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { decodeSubCursor, encodeSubCursor, isUuid } from "./guards";
import { usd } from "@/lib/creator/membership/engine";
import { withdrawalFlatFeeCents, type WithdrawalFlatFees } from "@/lib/rewards/config";

import { subConfig } from "./server";

/**
 * Creator earnings and analytics (Frenz Exclusive Part 7). Every number has ONE source:
 *
 *   balances (now)        sub_balances — the running totals the money functions keep under a row
 *                         lock (0227/0247). Never re-derived from a page of ledger rows.
 *                           available  withdrawable now
 *                           pending    earned, still inside the hold (0 with the default hold)
 *                           held       in a withdrawal that hasn't been paid or returned
 *                           debt       refunds of money already withdrawn, taken from future earnings
 *                           lifetime   all earnings net of clawbacks
 *                           withdrawn  gross amount of completed withdrawals
 *   period figures        sub_creator_summary / sub_creator_daily (0252) — aggregates in the database
 *                         over sub_ledger, sub_purchases, creator_memberships, withdrawal_requests.
 *   history               sub_ledger rows, keyset-paged; withdrawal rows carry their request's status.
 *
 * Creator money is USD cents throughout (the creator's price). What SUBSCRIBERS paid is kept per
 * charged currency (e.g. NGN) and never summed across currencies. The service fee is the platform's,
 * charged on top of the price: the creator's share is the full price.
 *
 * Every function takes the creator from the session (the route); every read is `creator_id = that`.
 */

type Row = Record<string, unknown>;
type Fail = { ok: false; error: string; status: number };
const fail = (error: string, status = 400): Fail => ({ ok: false, error, status });
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : 0);
export const PERIODS = [7, 30, 90] as const;
export type Period = (typeof PERIODS)[number];
export const isPeriod = (v: unknown): v is Period => PERIODS.includes(Number(v) as Period);
export const LEDGER_PAGE = 25;

export const LEDGER_KINDS = ["earning", "clawback", "release", "withdrawal_hold", "withdrawal_paid", "withdrawal_return", "adjustment"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];
/** The history filter's groups (one choice may cover several ledger kinds). */
export const LEDGER_FILTERS = { all: null, earnings: ["earning"], refunds: ["clawback"], released: ["release"], withdrawals: ["withdrawal_hold", "withdrawal_paid", "withdrawal_return"], adjustments: ["adjustment"] } as const;
export type LedgerFilter = keyof typeof LEDGER_FILTERS;
export const isLedgerFilter = (v: unknown): v is LedgerFilter => typeof v === "string" && v in LEDGER_FILTERS;

export interface Balances {
  availableCents: number;
  pendingCents: number;
  heldCents: number;
  debtCents: number;
  lifetimeCents: number;
  withdrawnCents: number;
}

export interface PeriodSummary {
  days: Period;
  since: string;
  earnedCents: number;
  clawedCents: number;
  /** earned − clawed: what the period added to the creator's earnings */
  netCents: number;
  newSubs: number;
  renewals: number;
  /** what subscribers paid (price + fee) for purchases settled in the period, per CHARGED currency, minor units */
  grossByCurrency: { currency: string; minor: number }[];
  refunds: number;
  accessEnded: number;
  cancellations: number;
  withdrawalsRequested: number;
  withdrawalsRequestedCents: number;
  withdrawalsCompleted: number;
  withdrawalsCompletedNetCents: number;
  postsPublished: number;
  likes: number;
  comments: number;
  daily: { day: string; netCents: number; newSubs: number; renewals: number }[];
}

export interface Overview {
  balances: Balances;
  activeSubscribers: number;
  ending: number;
  posts: { published: number; locked: number; hidden: number };
  withdrawal: { enabled: boolean; minCents: number; feePercent: number; flatFees: WithdrawalFlatFees; openRequest: boolean; reason: string | null };
  period: PeriodSummary | null;
  /** false before 0252 runs: balances and counts still show, period analytics say so */
  analyticsReady: boolean;
}

function toSummary(days: Period, since: string, s: Row, daily: Row[]): PeriodSummary {
  const g = (s.gross_by_currency ?? {}) as Record<string, unknown>;
  const earned = num(s.earned_cents);
  const clawed = num(s.clawed_cents);
  return {
    days,
    since,
    earnedCents: earned,
    clawedCents: clawed,
    netCents: earned - clawed,
    newSubs: num(s.new_subs),
    renewals: num(s.renewals),
    grossByCurrency: Object.entries(g)
      .map(([currency, minor]) => ({ currency, minor: num(minor) }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
    refunds: num(s.refunds),
    accessEnded: num(s.access_ended),
    cancellations: num(s.cancellations),
    withdrawalsRequested: num(s.withdrawals_requested),
    withdrawalsRequestedCents: num(s.withdrawals_requested_cents),
    withdrawalsCompleted: num(s.withdrawals_completed),
    withdrawalsCompletedNetCents: num(s.withdrawals_completed_net_cents),
    postsPublished: num(s.posts_published),
    likes: num(s.likes),
    comments: num(s.comments),
    daily: daily.map((d) => ({ day: String(d.day).slice(0, 10), netCents: num(d.earned_cents) - num(d.clawed_cents), newSubs: num(d.new_subs), renewals: num(d.renewals) })),
  };
}

/** The period's start: midnight UTC `days` days ago, so the daily series and the totals share one boundary. */
export function periodStart(days: Period, now = Date.now()): string {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

export async function earningsOverview(creatorId: string, days: Period = 30, now = Date.now()): Promise<({ ok: true } & Overview) | Fail> {
  if (!isUuid(creatorId)) return fail("Invalid request.");
  if (!isPeriod(days)) return fail("Choose 7, 30 or 90 days.");
  const db = createAdminClient();
  // move anything whose hold has passed to available first (the same call the earnings read always made)
  await db.rpc("release_sub_earnings", { p_creator: creatorId });
  const since = periodStart(days, now);
  const nowIso = new Date(now).toISOString();
  const [cfg, balR, activeR, pubR, hiddenR, openR, sumR, dayR] = await Promise.all([
    subConfig(),
    db.from("sub_balances").select("available_cents, pending_cents, held_cents, debt_cents, lifetime_cents, withdrawn_cents").eq("creator_id", creatorId).maybeSingle(),
    db.from("creator_memberships").select("id", { count: "exact", head: true }).eq("creator_id", creatorId).eq("billing", "sub").eq("status", "active").gt("period_end", nowIso),
    db.from("sub_posts").select("id", { count: "exact", head: true }).eq("creator_id", creatorId).eq("status", "published"),
    db.from("sub_posts").select("id", { count: "exact", head: true }).eq("creator_id", creatorId).eq("status", "published").eq("audience", "hidden"),
    db.from("withdrawal_requests").select("id").eq("user_id", creatorId).eq("source", "sub").in("status", ["pending", "reviewing", "approved", "processing"]).limit(1),
    db.rpc("sub_creator_summary", { p_creator: creatorId, p_since: since }),
    db.rpc("sub_creator_daily", { p_creator: creatorId, p_since: since }),
  ]);
  if (balR.error) return fail("Couldn't load your earnings.", 503);
  const b = (balR.data ?? {}) as Row;
  const balances: Balances = { availableCents: num(b.available_cents), pendingCents: num(b.pending_cents), heldCents: num(b.held_cents), debtCents: num(b.debt_cents), lifetimeCents: num(b.lifetime_cents), withdrawnCents: num(b.withdrawn_cents) };
  const published = pubR.error ? 0 : (pubR.count ?? 0);
  const hidden = hiddenR.error ? 0 : (hiddenR.count ?? 0);
  const openRequest = ((openR.data ?? []) as Row[]).length > 0;
  // the reason a withdrawal can't be asked for, in the same words the server would answer with
  const reason = !cfg.withdrawalsEnabled ? "Withdrawals are paused right now." : openRequest ? "You already have a withdrawal in progress." : balances.availableCents < cfg.minWithdrawalCents + withdrawalFlatFeeCents(cfg.minWithdrawalCents, cfg.flatFees) ? `The minimum withdrawal is ${usd(cfg.minWithdrawalCents)}, plus the ${usd(withdrawalFlatFeeCents(cfg.minWithdrawalCents, cfg.flatFees))} withdrawal fee.` : null;
  const analyticsReady = !sumR.error && !dayR.error;
  return {
    ok: true,
    balances,
    activeSubscribers: activeR.error ? 0 : (activeR.count ?? 0),
    // paid up but cancelled for the current period (0250) — counted in the database (0252), 0 before it runs
    ending: sumR.error ? 0 : num((sumR.data as Row | null)?.ending_now),
    posts: { published, locked: Math.max(0, published - hidden), hidden },
    withdrawal: { enabled: cfg.withdrawalsEnabled, minCents: cfg.minWithdrawalCents, feePercent: cfg.withdrawalFeePercent, flatFees: cfg.flatFees, openRequest, reason },
    period: analyticsReady ? toSummary(days, since, (sumR.data ?? {}) as Row, (dayR.data ?? []) as Row[]) : null,
    analyticsReady,
  };
}

export interface LedgerEntry {
  id: string;
  kind: LedgerKind;
  label: string;
  /** signed USD cents: + money in, − money out of the balance (a paid withdrawal is 0: it was already held) */
  amountCents: number;
  note: string | null;
  at: string;
  /** for withdrawal rows: the request's own status and money, from withdrawal_requests */
  withdrawal: { status: string; grossCents: number; feeCents: number; netCents: number } | null;
}

const KIND_LABEL: Record<LedgerKind, string> = {
  earning: "Subscription earning",
  clawback: "Refund or reversal",
  release: "Released to available",
  withdrawal_hold: "Withdrawal requested",
  withdrawal_paid: "Withdrawal paid",
  withdrawal_return: "Withdrawal returned",
  adjustment: "Adjustment",
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The creator's own ledger, newest first, LEDGER_PAGE at a time. Filters: a kind group and a UTC date range. */
export async function ledgerPage(creatorId: string, opts: { cursor?: string | null; filter?: string | null; from?: string | null; to?: string | null } = {}): Promise<({ ok: true; items: LedgerEntry[]; next: string | null }) | Fail> {
  if (!isUuid(creatorId)) return fail("Invalid request.");
  const c = decodeSubCursor(opts.cursor);
  if (c === "invalid" || (c && !c.id)) return fail("Bad cursor.");
  const filter = opts.filter ?? "all";
  if (!isLedgerFilter(filter)) return fail("Unknown filter.");
  if ((opts.from && !DATE.test(opts.from)) || (opts.to && !DATE.test(opts.to))) return fail("Dates are YYYY-MM-DD.");
  // the ledger id is an identity number: the cursor carries it as a fake uuid-free string, so check it ourselves
  const db = createAdminClient();
  let q = db.from("sub_ledger").select("id, kind, amount_cents, note, created_at, withdrawal_id").eq("creator_id", creatorId);
  const kinds = LEDGER_FILTERS[filter];
  if (kinds) q = q.in("kind", [...kinds]);
  if (opts.from) q = q.gte("created_at", `${opts.from}T00:00:00.000Z`);
  if (opts.to) q = q.lt("created_at", new Date(Date.parse(`${opts.to}T00:00:00.000Z`) + 86_400_000).toISOString());
  if (c?.id) q = q.or(`created_at.lt."${c.at}",and(created_at.eq."${c.at}",id.lt.${ledgerIdFromCursor(c.id)})`);
  const { data, error } = await q.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(LEDGER_PAGE + 1);
  if (error) return fail("Couldn't load your history.", 503);
  const rows = (data ?? []) as Row[];
  const page = rows.slice(0, LEDGER_PAGE);
  const wIds = [...new Set(page.map((r) => r.withdrawal_id as string | null).filter((x): x is string => !!x && isUuid(x)))];
  const wR = wIds.length ? await db.from("withdrawal_requests").select("id, status, gross_cents, fee_cents, net_cents").eq("user_id", creatorId).in("id", wIds) : { data: [] as Row[] };
  const w = new Map(((wR.data ?? []) as Row[]).map((r) => [r.id as string, r]));
  const last = page[page.length - 1];
  return {
    ok: true,
    items: page.map((r) => {
      const kind = (LEDGER_KINDS as readonly string[]).includes(r.kind as string) ? (r.kind as LedgerKind) : "adjustment";
      const wr = r.withdrawal_id ? w.get(r.withdrawal_id as string) : undefined;
      return {
        id: String(r.id),
        kind,
        label: KIND_LABEL[kind],
        amountCents: num(r.amount_cents),
        note: (r.note as string | null) ?? null,
        at: r.created_at as string,
        withdrawal: wr ? { status: String(wr.status), grossCents: num(wr.gross_cents), feeCents: num(wr.fee_cents), netCents: num(wr.net_cents) } : null,
      };
    }),
    next: rows.length > LEDGER_PAGE && last ? encodeSubCursor(last.created_at as string, ledgerIdToCursor(String(last.id))) : null,
  };
}

/*
  The shared cursor format carries a UUID; the ledger's id is a bigint. It is wrapped in a fixed UUID
  shape (zero-padded into the last group) so the existing, validated cursor codec can carry it.
*/
function ledgerIdToCursor(id: string): string {
  return `00000000-0000-4000-8000-${id.padStart(12, "0").slice(-12)}`;
}
function ledgerIdFromCursor(u: string): string {
  return String(Number(u.slice(-12)));
}
