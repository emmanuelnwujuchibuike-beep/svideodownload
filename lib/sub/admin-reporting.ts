import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { periodStart, isPeriod, type Period } from "./earnings";
import { decodeSubCursor, encodeSubCursor, isUuid } from "./guards";
import { subTargetDetails, type SubTargetType } from "./moderation";

/**
 * Admin reporting for Frenz Exclusive (Part 7). NOT an authorization layer: every route that calls
 * these checks `getAdminUser()` itself first (tests assert a 403 for anyone else). Everything here is
 * bounded: one aggregate call, or one keyset page of at most ADMIN_PAGE rows plus batched lookups.
 * Nothing here returns media links: reviewing exclusive media stays the audited sub-review route.
 */

type Row = Record<string, unknown>;
type Fail = { ok: false; error: string; status: number };
const fail = (error: string, status = 400): Fail => ({ ok: false, error, status });
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : 0);
export const ADMIN_PAGE = 25;

export interface AdminSummary {
  days: Period;
  since: string;
  memberships: number;
  active: number;
  ending: number;
  accessEnded: number;
  newSubs: number;
  renewals: number;
  /** what subscribers paid for purchases settled in the period, per charged currency (minor units) */
  grossByCurrency: { currency: string; minor: number }[];
  /** USD cents, purchases settled in the period, before refunds */
  creatorShareCents: number;
  platformFeeCents: number;
  refunds: number;
  refundedCreatorCents: number;
  refundDueOpen: number;
  withdrawalsOpen: number;
  withdrawalsOpenCents: number;
  reportsOpen: number;
  postsRemoved: number;
  commentsHidden: number;
}

export async function adminSummary(days: Period = 30, now = Date.now()): Promise<({ ok: true; summary: AdminSummary }) | Fail> {
  // All (0) is a creator-dashboard view (step 21); the admin report keeps its fixed windows
  if (!isPeriod(days) || days === 0) return fail("Choose 7, 30 or 90 days.");
  const since = periodStart(days, now);
  const { data, error } = await createAdminClient().rpc("sub_admin_summary", { p_since: since });
  if (error) return fail(/function|schema cache|does not exist/i.test(error.message) ? "The overview arrives with the next update (migration 0252)." : "Couldn't load the overview.", 503);
  const s = (data ?? {}) as Row;
  const g = (s.gross_by_currency ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    summary: {
      days,
      since,
      memberships: num(s.memberships),
      active: num(s.active),
      ending: num(s.ending),
      accessEnded: num(s.access_ended),
      newSubs: num(s.new_subs),
      renewals: num(s.renewals),
      grossByCurrency: Object.entries(g).map(([currency, minor]) => ({ currency, minor: num(minor) })).sort((a, b) => a.currency.localeCompare(b.currency)),
      creatorShareCents: num(s.creator_share_cents),
      platformFeeCents: num(s.platform_fee_cents),
      refunds: num(s.refunds),
      refundedCreatorCents: num(s.refunded_creator_cents),
      refundDueOpen: num(s.refund_due_open),
      withdrawalsOpen: num(s.withdrawals_open),
      withdrawalsOpenCents: num(s.withdrawals_open_cents),
      reportsOpen: num(s.reports_open),
      postsRemoved: num(s.posts_removed),
      commentsHidden: num(s.comments_hidden),
    },
  };
}

// ─── Search ──────────────────────────────────────────────────────────────────

export const PURCHASE_STATUSES = ["initiated", "paid", "failed", "refunded", "disputed", "reversed", "refund_due"] as const;
const HANDLE = /^@?[a-z0-9_.]{2,30}$/i;
const REF_PART = /^[a-z0-9_]{4,40}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface AdminPurchaseRow {
  id: string;
  reference: string;
  status: string;
  createdAt: string;
  paidAt: string | null;
  reversedAt: string | null;
  priceCents: number;
  feeCents: number;
  chargedCurrency: string;
  chargedMinor: number;
  creator: { id: string; handle: string | null };
  subscriber: { id: string; handle: string | null };
  /** the pair's membership as it is now */
  membership: { status: string; periodEnd: string | null; cancelled: boolean } | null;
}

async function resolvePerson(db: ReturnType<typeof createAdminClient>, raw: string | null | undefined): Promise<string | null | "none"> {
  if (!raw) return null;
  const v = raw.trim();
  if (isUuid(v)) return v;
  if (!HANDLE.test(v)) return "none";
  const { data } = await db.from("profiles").select("id").eq("handle", String(v).replace(/^@/, "").toLowerCase()).maybeSingle();
  return ((data as Row | null)?.id as string | undefined) ?? "none";
}

/**
 * Purchases matching every given filter, newest first, ADMIN_PAGE at a time. Creator and subscriber
 * by id or exact @handle; reference by a safe partial match (letters, digits and _ only, so nothing
 * reaches the filter grammar); status; created date range (UTC days).
 */
export async function adminSearch(opts: { creator?: string | null; subscriber?: string | null; reference?: string | null; status?: string | null; from?: string | null; to?: string | null; cursor?: string | null }): Promise<({ ok: true; items: AdminPurchaseRow[]; next: string | null }) | Fail> {
  const c = decodeSubCursor(opts.cursor);
  if (c === "invalid" || (c && !c.id)) return fail("Bad cursor.");
  if (opts.status && !(PURCHASE_STATUSES as readonly string[]).includes(opts.status)) return fail("Unknown status.");
  if ((opts.from && !DATE.test(opts.from)) || (opts.to && !DATE.test(opts.to))) return fail("Dates are YYYY-MM-DD.");
  const ref = opts.reference?.trim() || null;
  if (ref && !REF_PART.test(ref)) return fail("Search a reference with letters, digits and _ only (4 or more).");
  const db = createAdminClient();
  const [creator, subscriber] = await Promise.all([resolvePerson(db, opts.creator), resolvePerson(db, opts.subscriber)]);
  if (creator === "none" || subscriber === "none") return { ok: true, items: [], next: null };
  // only what the admin task needs: no provider ids, checkout links or FX internals
  let q = db.from("sub_purchases").select("id, reference, status, created_at, paid_at, reversed_at, price_cents, fee_cents, charged_currency, charged_minor, creator_id, subscriber_id");
  if (creator) q = q.eq("creator_id", creator);
  if (subscriber) q = q.eq("subscriber_id", subscriber);
  if (opts.status) q = q.eq("status", opts.status);
  if (ref) q = q.ilike("reference", `%${ref}%`);
  if (opts.from) q = q.gte("created_at", `${opts.from}T00:00:00.000Z`);
  if (opts.to) q = q.lt("created_at", new Date(Date.parse(`${opts.to}T00:00:00.000Z`) + 86_400_000).toISOString());
  if (c?.id) q = q.or(`created_at.lt."${c.at}",and(created_at.eq."${c.at}",id.lt.${c.id})`);
  const { data, error } = await q.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(ADMIN_PAGE + 1);
  if (error) return fail("Search failed.", 503);
  const rows = (data ?? []) as Row[];
  const page = rows.slice(0, ADMIN_PAGE);
  const people = [...new Set(page.flatMap((r) => [r.creator_id as string, r.subscriber_id as string]))];
  const creators = [...new Set(page.map((r) => r.creator_id as string))];
  const [profR, memR] = await Promise.all([
    people.length ? db.from("profiles").select("id, handle").in("id", people) : Promise.resolve({ data: [] as Row[] }),
    creators.length ? db.from("creator_memberships").select("*").in("creator_id", creators).in("member_id", [...new Set(page.map((r) => r.subscriber_id as string))]).eq("billing", "sub") : Promise.resolve({ data: [] as Row[] }),
  ]);
  const handle = new Map(((profR.data ?? []) as Row[]).map((p) => [p.id as string, (p.handle as string | null) ?? null]));
  const mem = new Map(((memR.data ?? []) as Row[]).map((m) => [`${m.creator_id as string}:${m.member_id as string}`, m]));
  const last = page[page.length - 1];
  return {
    ok: true,
    items: page.map((r) => {
      const m = mem.get(`${r.creator_id as string}:${r.subscriber_id as string}`);
      return {
        id: r.id as string,
        reference: r.reference as string,
        status: r.status as string,
        createdAt: r.created_at as string,
        paidAt: (r.paid_at as string | null) ?? null,
        reversedAt: (r.reversed_at as string | null) ?? null,
        priceCents: num(r.price_cents),
        feeCents: num(r.fee_cents),
        chargedCurrency: String(r.charged_currency ?? ""),
        chargedMinor: num(r.charged_minor),
        creator: { id: r.creator_id as string, handle: handle.get(r.creator_id as string) ?? null },
        subscriber: { id: r.subscriber_id as string, handle: handle.get(r.subscriber_id as string) ?? null },
        membership: m ? { status: String(m.status), periodEnd: (m.period_end as string | null) ?? null, cancelled: typeof m.cancel_period === "number" && m.cancel_period === m.period_index } : null,
      };
    }),
    next: rows.length > ADMIN_PAGE && last ? encodeSubCursor(last.created_at as string, last.id as string) : null,
  };
}

// ─── Moderation history ──────────────────────────────────────────────────────

export const MOD_FILTERS = ["open", "removed", "restored", "dismissed"] as const;
export type ModFilter = (typeof MOD_FILTERS)[number];
export const isModFilter = (v: unknown): v is ModFilter => typeof v === "string" && (MOD_FILTERS as readonly string[]).includes(v);

export interface ModRow {
  targetType: SubTargetType;
  targetId: string;
  title: string;
  handle: string | null;
  /** the content's state now: published / archived (post), visible / hidden (comment), missing */
  state: string;
  at: string;
  /** open reports (for 'open'), or the report / audit facts behind this row */
  reasons: string[];
  reports: number;
  note: string | null;
}

/**
 * Exclusive moderation by state, one type at a time, ADMIN_PAGE per page (keyset on time, id):
 *   open       reports still open (newest report first, grouped per target within the page)
 *   removed    posts taken down (archived) / comments hidden — the content's own state
 *   restored   restore actions from the security audit log (who/when/why recorded there)
 *   dismissed  reports dismissed
 */
export async function adminModeration(filter: string, type: string, cursor?: string | null): Promise<({ ok: true; items: ModRow[]; next: string | null }) | Fail> {
  if (!isModFilter(filter) || (type !== "sub_post" && type !== "sub_comment")) return fail("Unknown filter.");
  const c = decodeSubCursor(cursor);
  if (c === "invalid" || (c && !c.id)) return fail("Bad cursor.");
  const db = createAdminClient();
  const after = (col: string) => (c?.id ? `${col}.lt."${c.at}",and(${col}.eq."${c.at}",id.lt.${c.id})` : null);
  let base: { id: string; targetId: string; at: string; reason: string | null; note: string | null }[] = [];
  let rows: Row[] = [];
  if (filter === "open" || filter === "dismissed") {
    let q = db.from("reports").select("id, target_id, reason, note, created_at").eq("target_type", type).eq("status", filter === "open" ? "open" : "dismissed");
    const a = after("created_at");
    if (a) q = q.or(a);
    const { data, error } = await q.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(ADMIN_PAGE + 1);
    if (error) return fail("Couldn't load reports.", 503);
    rows = (data ?? []) as Row[];
    base = rows.slice(0, ADMIN_PAGE).map((r) => ({ id: r.id as string, targetId: r.target_id as string, at: r.created_at as string, reason: (r.reason as string | null) ?? null, note: (r.note as string | null) ?? null }));
  } else if (filter === "removed") {
    const col = type === "sub_post" ? "moderated_at" : "hidden_at";
    let q = type === "sub_post" ? db.from("sub_posts").select("id, moderated_at").eq("status", "archived").not("moderated_at", "is", null) : db.from("sub_post_comments").select("id, hidden_at").not("hidden_at", "is", null);
    const a = after(col);
    if (a) q = q.or(a);
    const { data, error } = await q.order(col, { ascending: false }).order("id", { ascending: false }).limit(ADMIN_PAGE + 1);
    if (error) return fail("Couldn't load removed content.", 503);
    rows = ((data ?? []) as Row[]).map((r) => ({ ...r, created_at: r[col] }));
    base = rows.slice(0, ADMIN_PAGE).map((r) => ({ id: r.id as string, targetId: r.id as string, at: r.created_at as string, reason: null, note: null }));
  } else {
    let q = db.from("security_audit_log").select("id, target_id, metadata, created_at").eq("event_type", "moderation_action").eq("target_type", type).eq("metadata->>action", "restore");
    const a = after("created_at");
    if (a) q = q.or(a);
    const { data, error } = await q.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(ADMIN_PAGE + 1);
    if (error) return fail("Couldn't load restores.", 503);
    rows = (data ?? []) as Row[];
    base = rows.slice(0, ADMIN_PAGE).map((r) => ({ id: String(r.id), targetId: r.target_id as string, at: r.created_at as string, reason: null, note: (((r.metadata ?? {}) as Row).note as string | undefined) ?? null }));
  }
  const ids = [...new Set(base.map((b) => b.targetId).filter(isUuid))];
  const details = await subTargetDetails(type === "sub_post" ? { posts: ids, comments: [] } : { posts: [], comments: ids });
  // one row per target within the page (several reports of one post read as one row with a count)
  const grouped = new Map<string, ModRow>();
  for (const b of base) {
    const d = details.get(`${type}:${b.targetId}`);
    const g = grouped.get(b.targetId);
    if (g) {
      g.reports += 1;
      if (b.reason && !g.reasons.includes(b.reason) && g.reasons.length < 5) g.reasons.push(b.reason);
      continue;
    }
    grouped.set(b.targetId, { targetType: type, targetId: b.targetId, title: d?.title ?? (type === "sub_post" ? "Exclusive post (deleted)" : "Comment (deleted)"), handle: d?.handle ?? null, state: d?.status ?? "missing", at: b.at, reasons: b.reason ? [b.reason] : [], reports: filter === "open" || filter === "dismissed" ? 1 : 0, note: b.note });
  }
  const lastRow = rows.length > ADMIN_PAGE ? base[base.length - 1] : null;
  return { ok: true, items: [...grouped.values()], next: lastRow ? encodeSubCursor(lastRow.at, cursorId(lastRow.id)) : null };
}

/* the audit log's id is a bigint; reports, posts and comments use uuids (same wrapping as the ledger cursor) */
function cursorId(id: string): string {
  return isUuid(id) ? id : `00000000-0000-4000-8000-${String(id).padStart(12, "0").slice(-12)}`;
}
