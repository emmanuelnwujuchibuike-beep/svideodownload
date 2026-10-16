import "server-only";

import { subscriptionCharge, usd } from "@/lib/creator/membership/engine";
import { flagsOf, isAccountVisibleTo } from "@/lib/social/account-visibility";
import { createAdminClient } from "@/lib/supabase/admin";

import { decodeSubCursor, encodeSubCursor, isUuid, SUB_ABANDON_GRACE_MS } from "./guards";
import {
  creatorStatusLabel,
  hasAccess,
  isCancelled,
  paidThrough,
  STATE_LABEL,
  stateLine,
  subActions,
  subState,
  txView,
  type MembershipFacts,
  type SubActions,
  type SubState,
  type TxRow,
  type TxView,
} from "./lifecycle";
import { subConfig } from "./server";

/**
 * Subscriber management (Frenz Exclusive Part 5): the subscriber's own subscriptions, cancel and
 * resume, their transactions and receipts, and the creator's paged subscriber list.
 *
 * Every function takes the session user's id from the route — never an id from the body — and
 * every read is filtered by it (`member_id` / `subscriber_id` / `creator_id` = that user), so
 * nobody reads another person's memberships or payments. Reads go through the service role
 * (server-only); RLS stays as it was (parties-read only), and this file never writes money.
 *
 * Dates, amounts, currencies and statuses all come from the database rows the money functions
 * wrote. A purchase is "paid" only because `settle_sub_purchase` settled a charge Paystack
 * verified: nothing here — and nothing the browser sends — can make one look paid.
 */

type Row = Record<string, unknown>;
type Fail = { ok: false; error: string; status: number; reason?: string };
const fail = (error: string, status = 400, reason?: string): Fail => ({ ok: false, error, status, reason });
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const MAX_MEMBERSHIPS = 100;
export const TX_PAGE = 20;
export const SUBSCRIBERS_PAGE = 30;
const REVERSED = new Set(["refunded", "disputed", "reversed"]);
const SETTLED = new Set(["paid", "refunded", "disputed", "reversed", "refund_due"]);

export interface PersonLite {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  verified: boolean;
}

function facts(r: Row): MembershipFacts {
  const cp = r.cancel_period;
  return {
    status: String(r.status ?? "ended"),
    billing: String(r.billing ?? "free"),
    periodEnd: str(r.period_end),
    periodIndex: Number(r.period_index ?? 0),
    // before 0250 the column isn't there: never cancelled
    cancelPeriod: typeof cp === "number" ? cp : null,
    joinedAt: str(r.joined_at),
    endedAt: str(r.ended_at),
  };
}

async function profilesOf(ids: readonly string[]): Promise<Map<string, PersonLite & { suspended: boolean; hidden: boolean }>> {
  const out = new Map<string, PersonLite & { suspended: boolean; hidden: boolean }>();
  const want = [...new Set(ids)].filter(isUuid);
  if (!want.length) return out;
  const { data } = await createAdminClient().from("profiles").select("id, handle, display_name, avatar_url, is_verified, is_suspended, is_hidden").in("id", want);
  for (const p of (data ?? []) as Row[]) {
    if (!p.handle) continue;
    out.set(p.id as string, { id: p.id as string, handle: p.handle as string, displayName: str(p.display_name) ?? `@${p.handle as string}`, avatarUrl: str(p.avatar_url), verified: !!p.is_verified, suspended: !!p.is_suspended, hidden: !!p.is_hidden });
  }
  return out;
}

/** Everyone in `others` with a block either way with `me`. A failed read counts everyone as blocked (fails closed). */
async function blockedWith(me: string, others: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(others)].filter(isUuid);
  if (!ids.length) return new Set();
  const db = createAdminClient();
  const [a, b] = await Promise.all([db.from("blocks").select("blocked_id").eq("blocker_id", me).in("blocked_id", ids), db.from("blocks").select("blocker_id").eq("blocked_id", me).in("blocker_id", ids)]);
  if (a.error || b.error) return new Set(ids);
  return new Set([...((a.data ?? []) as Row[]).map((r) => r.blocked_id as string), ...((b.data ?? []) as Row[]).map((r) => r.blocker_id as string)]);
}

// ─── The subscriber's subscriptions ──────────────────────────────────────────

export interface SubscriptionItem {
  id: string;
  creator: PersonLite;
  state: SubState;
  label: string;
  line: string;
  /** the access-until time on the membership row — the same value `hasActiveSub` reads */
  periodEnd: string | null;
  startedAt: string | null;
  access: boolean;
  actions: SubActions;
  /** what a renewal costs right now (price + fee), from the creator's live price — null when it can't be bought */
  renewPrice: string | null;
}

export async function mySubscriptions(memberId: string, now = Date.now()): Promise<({ ok: true; items: SubscriptionItem[] }) | Fail> {
  if (!isUuid(memberId)) return fail("Invalid request.");
  const db = createAdminClient();
  const { data, error } = await db.from("creator_memberships").select("*").eq("member_id", memberId).eq("billing", "sub").order("joined_at", { ascending: false }).limit(MAX_MEMBERSHIPS);
  if (error) return fail("Couldn't load your subscriptions.", 503);
  const rows = (data ?? []) as Row[];
  if (!rows.length) return { ok: true, items: [] };
  const ids = rows.map((r) => r.creator_id as string);
  const [cfg, who, blocked, settingsR, purchasesR] = await Promise.all([
    subConfig(),
    profilesOf(ids),
    blockedWith(memberId, ids),
    db.from("creator_membership_settings").select("creator_id, sub_active, sub_price_cents").in("creator_id", ids),
    db.from("sub_purchases").select("creator_id, status, created_at").eq("subscriber_id", memberId).in("creator_id", ids).order("created_at", { ascending: false }).limit(500),
  ]);
  const settings = new Map(((settingsR.data ?? []) as Row[]).map((s) => [s.creator_id as string, s]));
  const lastSettled = new Map<string, string>();
  const pending = new Set<string>();
  for (const p of (purchasesR.data ?? []) as Row[]) {
    const cid = p.creator_id as string;
    if (SETTLED.has(p.status as string) && !lastSettled.has(cid)) lastSettled.set(cid, p.status as string);
    if (p.status === "initiated" && now - Date.parse(p.created_at as string) < SUB_ABANDON_GRACE_MS) pending.add(cid);
  }
  const items: SubscriptionItem[] = [];
  for (const r of rows) {
    const cid = r.creator_id as string;
    const creator = who.get(cid);
    if (!creator) continue;
    const m = facts(r);
    const s = settings.get(cid);
    const isBlocked = blocked.has(cid);
    const state = subState(m, { now, blocked: isBlocked, creatorAvailable: !creator.suspended, lastPurchaseStatus: lastSettled.get(cid) ?? null, pendingPayment: pending.has(cid) });
    const price = Number(s?.sub_price_cents ?? 0);
    // exactly checkout's own refusals: paused, not live, blocked, suspended or hidden creator, removed
    const canPurchase = cfg.purchasesEnabled && !!s?.sub_active && price > 0 && !isBlocked && !creator.suspended && isAccountVisibleTo(flagsOf({ is_suspended: creator.suspended, is_hidden: creator.hidden }), "stranger") && state !== "removed";
    const actions = subActions(state, m, { now, canPurchase });
    items.push({
      id: r.id as string,
      creator: { id: creator.id, handle: creator.handle, displayName: creator.displayName, avatarUrl: creator.avatarUrl, verified: creator.verified },
      state,
      label: STATE_LABEL[state],
      line: stateLine(state, m.periodEnd),
      periodEnd: m.periodEnd,
      startedAt: m.joinedAt,
      access: hasAccess(state),
      actions,
      renewPrice: actions.renew ? `${usd(subscriptionCharge(price, cfg.purchaseFeePercent).totalCents)} for ${cfg.periodDays} days` : null,
    });
  }
  return { ok: true, items };
}

// ─── Cancel and resume ───────────────────────────────────────────────────────

const AUDIT = (memberId: string, action: string, membershipId: string, details: Row) =>
  createAdminClient()
    .from("financial_audit_log")
    .insert({ actor_id: memberId, action, target_type: "creator_membership", target_id: membershipId, details })
    .then(({ error }) => {
      if (error) console.error("[sub/subscriptions] audit failed", { action, membershipId, error: error.message.slice(0, 120) });
    });

async function readMembership(memberId: string, creatorId: string): Promise<Row | null | "error"> {
  const { data, error } = await createAdminClient().from("creator_memberships").select("*").eq("creator_id", creatorId).eq("member_id", memberId).maybeSingle();
  return error ? "error" : ((data as Row | null) ?? null);
}

/**
 * "I won't renew." Access is untouched: status and period_end stay exactly as the payment left
 * them, so the subscriber keeps what they paid for. Repeating it answers `already`. The write is
 * conditional on the row not having moved (same period, same cancellation value), so a renewal
 * settling at the same moment is never overwritten — the caller is told to look again.
 */
export async function cancelSubscription(memberId: string, creatorId: string, now = Date.now()): Promise<({ ok: true; already: boolean; periodEnd: string | null }) | Fail> {
  if (!isUuid(memberId) || !isUuid(creatorId)) return fail("Invalid request.");
  const row = await readMembership(memberId, creatorId);
  if (row === "error") return fail("Couldn't save that.", 500);
  if (!row || row.billing !== "sub") return fail("You don't have a subscription to this creator.", 404, "none");
  const m = facts(row);
  if (!paidThrough(m, now)) return fail("This subscription has already ended.", 409, "not_active");
  if (isCancelled(m)) return { ok: true, already: true, periodEnd: m.periodEnd };
  if (!("cancel_period" in row)) return fail("Cancelling arrives with the next update.", 503, "pending_migration");
  let q = createAdminClient()
    .from("creator_memberships")
    .update({ cancelled_at: new Date(now).toISOString(), cancel_period: m.periodIndex })
    .eq("id", row.id as string)
    .eq("member_id", memberId)
    .eq("status", "active")
    .eq("period_index", m.periodIndex);
  q = m.cancelPeriod === null ? q.is("cancel_period", null) : q.eq("cancel_period", m.cancelPeriod);
  const { data, error } = await q.select("id");
  if (error) return fail("Couldn't save that.", 500);
  if (!((data ?? []) as Row[]).length) {
    // someone else moved it first: another cancel (fine), or a renewal / refund (look again)
    const again = await readMembership(memberId, creatorId);
    if (again && again !== "error" && paidThrough(facts(again), now) && isCancelled(facts(again))) return { ok: true, already: true, periodEnd: facts(again).periodEnd };
    return fail("Your subscription just changed. Refresh and try again.", 409, "changed");
  }
  await AUDIT(memberId, "sub_membership_cancelled", row.id as string, { creator_id: creatorId, member_id: memberId, period_index: m.periodIndex, period_end: m.periodEnd });
  return { ok: true, already: false, periodEnd: m.periodEnd };
}

/** Takes the cancellation back while the paid time is still running. It never grants or extends access. */
export async function resumeSubscription(memberId: string, creatorId: string, now = Date.now()): Promise<({ ok: true; already: boolean; periodEnd: string | null }) | Fail> {
  if (!isUuid(memberId) || !isUuid(creatorId)) return fail("Invalid request.");
  const row = await readMembership(memberId, creatorId);
  if (row === "error") return fail("Couldn't save that.", 500);
  if (!row || row.billing !== "sub") return fail("You don't have a subscription to this creator.", 404, "none");
  const m = facts(row);
  // an ended subscription comes back only through a new verified payment
  if (!paidThrough(m, now)) return fail("This subscription has ended. Renew it to get access again.", 409, "not_active");
  if (!isCancelled(m)) return { ok: true, already: true, periodEnd: m.periodEnd };
  const { data, error } = await createAdminClient()
    .from("creator_memberships")
    .update({ cancelled_at: null, cancel_period: null })
    .eq("id", row.id as string)
    .eq("member_id", memberId)
    .eq("status", "active")
    .eq("period_index", m.periodIndex)
    .eq("cancel_period", m.periodIndex)
    .select("id");
  if (error) return fail("Couldn't save that.", 500);
  if (!((data ?? []) as Row[]).length) return fail("Your subscription just changed. Refresh and try again.", 409, "changed");
  await AUDIT(memberId, "sub_membership_resumed", row.id as string, { creator_id: creatorId, member_id: memberId, period_index: m.periodIndex, period_end: m.periodEnd });
  return { ok: true, already: false, periodEnd: m.periodEnd };
}

// ─── Transactions and receipts ───────────────────────────────────────────────

// only what the subscriber may see: no provider_ref, checkout_url, failure_source or fx internals
const TX_COLS = "id, creator_id, status, created_at, paid_at, reversed_at, price_cents, fee_cents, total_cents, charged_currency, charged_minor, period_days, period_start, period_end, reference";

function txRow(r: Row): TxRow {
  return {
    id: r.id as string,
    creatorId: r.creator_id as string,
    status: String(r.status ?? ""),
    createdAt: r.created_at as string,
    paidAt: str(r.paid_at),
    reversedAt: str(r.reversed_at),
    priceCents: Number(r.price_cents ?? 0),
    feeCents: Number(r.fee_cents ?? 0),
    totalCents: Number(r.total_cents ?? 0),
    chargedCurrency: String(r.charged_currency ?? "USD"),
    chargedMinor: Number(r.charged_minor ?? 0),
    periodDays: Number(r.period_days ?? 0),
    periodStart: str(r.period_start),
    periodEnd: str(r.period_end),
    reference: String(r.reference ?? ""),
  };
}

export interface TxPage {
  items: (TxView & { creator: PersonLite | null })[];
  next: string | null;
}

/** The subscriber's own subscription payments, newest first, keyset-paged (created_at desc, id desc). */
export async function myTransactions(memberId: string, cursor?: string | null, now = Date.now()): Promise<({ ok: true } & TxPage) | Fail> {
  if (!isUuid(memberId)) return fail("Invalid request.");
  const c = decodeSubCursor(cursor);
  if (c === "invalid" || (c && !c.id)) return fail("Bad cursor.");
  let q = createAdminClient().from("sub_purchases").select(TX_COLS).eq("subscriber_id", memberId);
  if (c?.id) q = q.or(`created_at.lt."${c.at}",and(created_at.eq."${c.at}",id.lt.${c.id})`);
  const { data, error } = await q.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(TX_PAGE + 1);
  if (error) return fail("Couldn't load your payments.", 503);
  const rows = ((data ?? []) as Row[]).map(txRow);
  const page = rows.slice(0, TX_PAGE);
  const who = await profilesOf(page.map((r) => r.creatorId));
  const last = page[page.length - 1];
  return {
    ok: true,
    items: page.map((r) => {
      const p = who.get(r.creatorId);
      return { ...txView(r, now), creator: p ? { id: p.id, handle: p.handle, displayName: p.displayName, avatarUrl: p.avatarUrl, verified: p.verified } : null };
    }),
    next: rows.length > TX_PAGE && last ? encodeSubCursor(last.createdAt, last.id) : null,
  };
}

/** One of the subscriber's OWN purchases. Anyone else's id answers exactly like a missing one. */
export async function myReceipt(memberId: string, purchaseId: string, now = Date.now()): Promise<(TxView & { creator: PersonLite | null }) | null> {
  if (!isUuid(memberId) || !isUuid(purchaseId)) return null;
  const { data, error } = await createAdminClient().from("sub_purchases").select(TX_COLS).eq("id", purchaseId).eq("subscriber_id", memberId).maybeSingle();
  if (error || !data) return null;
  const r = txRow(data as Row);
  const p = (await profilesOf([r.creatorId])).get(r.creatorId);
  return { ...txView(r, now), creator: p ? { id: p.id, handle: p.handle, displayName: p.displayName, avatarUrl: p.avatarUrl, verified: p.verified } : null };
}

// ─── The creator's subscribers ───────────────────────────────────────────────

export type SubscriberFilter = "current" | "all";

export interface SubscriberRow {
  membershipId: string;
  person: PersonLite;
  state: SubState;
  label: string;
  startedAt: string | null;
  periodEnd: string | null;
  access: boolean;
}

/**
 * The creator's PAID subscribers, one bounded page at a time (keyset on joined_at desc, id desc),
 * read only with `creator_id` = the session user. No amounts, references or payment details: a
 * subscriber's money is in the creator's earnings ledger as a total, never per person here.
 * "current" = paid time still running (what `subEarnings` counts as active).
 */
export async function creatorSubscribers(creatorId: string, opts: { cursor?: string | null; filter?: SubscriberFilter } = {}, now = Date.now()): Promise<({ ok: true; items: SubscriberRow[]; next: string | null }) | Fail> {
  if (!isUuid(creatorId)) return fail("Invalid request.");
  const c = decodeSubCursor(opts.cursor);
  if (c === "invalid" || (c && !c.id)) return fail("Bad cursor.");
  const db = createAdminClient();
  let q = db.from("creator_memberships").select("*").eq("creator_id", creatorId).eq("billing", "sub");
  if (opts.filter !== "all") q = q.eq("status", "active").gt("period_end", new Date(now).toISOString());
  if (c?.id) q = q.or(`joined_at.lt."${c.at}",and(joined_at.eq."${c.at}",id.lt.${c.id})`);
  const { data, error } = await q.order("joined_at", { ascending: false }).order("id", { ascending: false }).limit(SUBSCRIBERS_PAGE + 1);
  if (error) return fail("Couldn't load your subscribers.", 503);
  const rows = (data ?? []) as Row[];
  const page = rows.slice(0, SUBSCRIBERS_PAGE);
  const ids = page.map((r) => r.member_id as string);
  const [who, blocked, purchasesR] = await Promise.all([
    profilesOf(ids),
    blockedWith(creatorId, ids),
    ids.length ? db.from("sub_purchases").select("subscriber_id, status, created_at").eq("creator_id", creatorId).in("subscriber_id", ids).order("created_at", { ascending: false }).limit(SUBSCRIBERS_PAGE * 10) : Promise.resolve({ data: [] as Row[] }),
  ]);
  const lastSettled = new Map<string, string>();
  for (const p of (purchasesR.data ?? []) as Row[]) if (SETTLED.has(p.status as string) && !lastSettled.has(p.subscriber_id as string)) lastSettled.set(p.subscriber_id as string, p.status as string);
  const items: SubscriberRow[] = [];
  for (const r of page) {
    const p = who.get(r.member_id as string);
    // a suspended account isn't listed (as on the dashboard); its access is unchanged by this read
    if (!p || p.suspended) continue;
    const m = facts(r);
    const last = lastSettled.get(p.id) ?? null;
    const state = subState(m, { now, blocked: blocked.has(p.id), creatorAvailable: true, lastPurchaseStatus: last && REVERSED.has(last) ? last : null, pendingPayment: false });
    items.push({ membershipId: r.id as string, person: { id: p.id, handle: p.handle, displayName: p.displayName, avatarUrl: p.avatarUrl, verified: p.verified }, state, label: creatorStatusLabel(state), startedAt: m.joinedAt, periodEnd: m.periodEnd, access: hasAccess(state) });
  }
  const last = page[page.length - 1];
  return { ok: true, items, next: rows.length > SUBSCRIBERS_PAGE && last ? encodeSubCursor(last.joined_at as string, last.id as string) : null };
}
