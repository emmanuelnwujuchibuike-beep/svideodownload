import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { isUuid } from "./guards";
import { isSubMonths, promotionStatus, validatePromotion, type PromotionInput, type PromotionRule, type PromotionStatus, type SubMonths } from "./pricing";
import { getSubSettings } from "./server";

/**
 * Exclusive promotions (0277) — a creator's time-boxed offers, and the admin's pause.
 *
 * Every write goes through here with the session's own user id as the creator (the table has no member write
 * policy), so a creator only ever touches their own rows. Status is computed from the window and the pause switch
 * at server time (pricing.ts `promotionStatus`), never stored.
 *
 * EDITING (the brief: never silently reprice a checkout, keep the limit honest): every purchase stores its own price,
 * so no edit can reprice one. Once ANY purchase has used a promotion its price, durations and start are locked — the
 * creator pauses it and creates a new one. The name, description and end date stay editable, and the limit may be
 * raised (never lowered below what is already redeemed).
 */

type Row = Record<string, unknown>;
type Fail = { ok: false; error: string; status: number };
const fail = (error: string, status = 400): Fail => ({ ok: false, error, status });
const MISSING = (m: string) => /schema cache|does not exist|column|relation/i.test(m);
const UNAVAILABLE = fail("Promotions arrive with the next update.", 503);
/** a creator's history of promotions is bounded */
const MAX_PROMOTIONS = 100;
/** an initiated checkout holds a redemption slot this long (0277 counts the same window) */
const LIVE_HOLD_MS = 30 * 60_000;

export const PROMOTION_COLUMNS = "id, creator_id, name, description, kind, percent_off, fixed_price_cents, durations, starts_at, ends_at, max_redemptions, paused, paused_by, paused_at, created_at";

export interface PromotionView extends PromotionRule {
  name: string;
  description: string | null;
  status: PromotionStatus;
  pausedBy: "creator" | "admin" | null;
  createdAt: string;
  /** verified redemptions: paid (or paid and owed back) purchases */
  redeemed: number;
  /** what the limit counts: verified + checkouts opened in the last 30 minutes */
  live: number;
  /** any purchase at all has used it — its price, durations and start are locked */
  used: boolean;
}

export function toRule(r: Row): PromotionRule & { name: string; description: string | null; pausedBy: "creator" | "admin" | null; createdAt: string } {
  const durations = (Array.isArray(r.durations) ? r.durations : []).map(Number).filter(isSubMonths) as SubMonths[];
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    description: (r.description as string | null) ?? null,
    kind: r.kind === "fixed" ? "fixed" : "percent",
    percentOff: r.percent_off === null || r.percent_off === undefined ? null : Number(r.percent_off),
    fixedPriceCents: r.fixed_price_cents === null || r.fixed_price_cents === undefined ? null : Number(r.fixed_price_cents),
    durations,
    startsAt: String(r.starts_at),
    endsAt: String(r.ends_at),
    maxRedemptions: r.max_redemptions === null || r.max_redemptions === undefined ? null : Number(r.max_redemptions),
    paused: !!r.paused,
    pausedBy: r.paused_by === "admin" ? "admin" : r.paused_by === "creator" ? "creator" : null,
    createdAt: String(r.created_at ?? ""),
  };
}

/** Per promotion: verified redemptions, the live count the limit uses, and whether anything used it. */
export async function promotionCounts(db: ReturnType<typeof createAdminClient>, ids: string[], now = Date.now()): Promise<Map<string, { redeemed: number; live: number; used: boolean }>> {
  const out = new Map<string, { redeemed: number; live: number; used: boolean }>();
  for (const id of ids) out.set(id, { redeemed: 0, live: 0, used: false });
  if (!ids.length) return out;
  const { data, error } = await db.from("sub_purchases").select("promotion_id, status, created_at").in("promotion_id", ids).limit(20_000);
  if (error) throw new Error(`sub_purchases: ${error.message}`);
  for (const r of (data ?? []) as Row[]) {
    const c = out.get(String(r.promotion_id));
    if (!c) continue;
    c.used = true;
    const verified = r.status === "paid" || r.status === "refund_due";
    if (verified) c.redeemed += 1;
    if (verified || (r.status === "initiated" && now - Date.parse(String(r.created_at)) < LIVE_HOLD_MS)) c.live += 1;
  }
  return out;
}

async function views(db: ReturnType<typeof createAdminClient>, rows: Row[], now: number): Promise<PromotionView[]> {
  const counts = await promotionCounts(db, rows.map((r) => String(r.id)), now);
  return rows.map((r) => {
    const rule = toRule(r);
    const c = counts.get(rule.id) ?? { redeemed: 0, live: 0, used: false };
    return { ...rule, status: promotionStatus(rule, now), ...c };
  });
}

/** The creator's own promotions, newest first. */
export async function creatorPromotions(creatorId: string, now = Date.now()): Promise<{ ok: true; items: PromotionView[] } | Fail> {
  if (!isUuid(creatorId)) return fail("Invalid request.");
  const db = createAdminClient();
  const { data, error } = await db.from("sub_promotions").select(PROMOTION_COLUMNS).eq("creator_id", creatorId).order("created_at", { ascending: false }).limit(MAX_PROMOTIONS);
  if (error) return MISSING(error.message) ? UNAVAILABLE : fail("Couldn't load your promotions.", 500);
  try {
    return { ok: true, items: await views(db, (data ?? []) as Row[], now) };
  } catch {
    return fail("Couldn't load your promotions.", 500);
  }
}

/**
 * The promotions a subscriber could use right now (active, with their live counts) — for the offer and for
 * checkout. A failed read is "no promotion": the regular prices still sell.
 */
export async function activePromotions(creatorId: string, now = Date.now()): Promise<{ rules: PromotionRule[]; live: Record<string, number>; names: Record<string, string> }> {
  const none = { rules: [], live: {}, names: {} };
  if (!isUuid(creatorId)) return none;
  const db = createAdminClient();
  const at = new Date(now).toISOString();
  const { data, error } = await db.from("sub_promotions").select(PROMOTION_COLUMNS).eq("creator_id", creatorId).eq("paused", false).lte("starts_at", at).gt("ends_at", at).limit(MAX_PROMOTIONS);
  if (error || !data?.length) return none;
  try {
    const rows = (data as Row[]).map(toRule);
    const counts = await promotionCounts(db, rows.map((r) => r.id), now);
    return { rules: rows, live: Object.fromEntries(rows.map((r) => [r.id, counts.get(r.id)?.live ?? 0])), names: Object.fromEntries(rows.map((r) => [r.id, r.name])) };
  } catch {
    return none;
  }
}

/** One promotion of this creator, for checkout (null when it isn't theirs or doesn't exist). */
export async function promotionForCheckout(creatorId: string, promotionId: string): Promise<(PromotionRule & { name: string }) | null | "unavailable"> {
  if (!isUuid(promotionId)) return null;
  const { data, error } = await createAdminClient().from("sub_promotions").select(PROMOTION_COLUMNS).eq("id", promotionId).maybeSingle();
  if (error) return MISSING(error.message) ? "unavailable" : null;
  if (!data || (data as Row).creator_id !== creatorId) return null;
  return toRule(data as Row);
}

const promotionRow = (v: Extract<ReturnType<typeof validatePromotion>, { ok: true }>["value"]) => ({
  name: v.name,
  description: v.description,
  kind: v.kind,
  percent_off: v.percentOff,
  fixed_price_cents: v.fixedPriceCents,
  durations: v.durations,
  starts_at: v.startsAt,
  ends_at: v.endsAt,
  max_redemptions: v.maxRedemptions,
});

export async function createPromotion(creatorId: string, input: PromotionInput, now = Date.now()): Promise<{ ok: true; id: string } | Fail> {
  if (!isUuid(creatorId)) return fail("Invalid request.");
  const s = await getSubSettings(creatorId);
  if (!s.ready) return UNAVAILABLE;
  if (!s.setupCompleted || !s.priceCents) return fail("Set up your subscription price first.");
  const v = validatePromotion(input, { monthlyCents: s.priceCents, bundles: s.bundlePrices, now, isNew: true });
  if (!v.ok) return fail(v.error);
  const db = createAdminClient();
  const { count, error: cErr } = await db.from("sub_promotions").select("id", { count: "exact", head: true }).eq("creator_id", creatorId);
  if (cErr) return MISSING(cErr.message) ? UNAVAILABLE : fail("Couldn't save the promotion.", 500);
  if ((count ?? 0) >= MAX_PROMOTIONS) return fail(`You can keep up to ${MAX_PROMOTIONS} promotions.`, 409);
  const { data, error } = await db.from("sub_promotions").insert({ creator_id: creatorId, ...promotionRow(v.value) }).select("id").single();
  if (error || !data) return error && MISSING(error.message) ? UNAVAILABLE : fail("Couldn't save the promotion.", 500);
  return { ok: true, id: String((data as Row).id) };
}

export type PromotionEdit = { op: "pause" } | { op: "resume" } | ({ op: "edit" } & PromotionInput);

/** A creator's change to their OWN promotion. Someone else's id answers "not found" — never a hint that it exists. */
export async function updatePromotion(creatorId: string, promotionId: string, edit: PromotionEdit, now = Date.now()): Promise<{ ok: true } | Fail> {
  if (!isUuid(creatorId) || !isUuid(promotionId)) return fail("Not found.", 404);
  const db = createAdminClient();
  const { data, error } = await db.from("sub_promotions").select(PROMOTION_COLUMNS).eq("id", promotionId).maybeSingle();
  if (error) return MISSING(error.message) ? UNAVAILABLE : fail("Couldn't save the promotion.", 500);
  if (!data || (data as Row).creator_id !== creatorId) return fail("Not found.", 404);
  const cur = toRule(data as Row);
  const at = new Date(now).toISOString();
  const status = promotionStatus(cur, now);

  if (edit.op === "pause" || edit.op === "resume") {
    if (status === "expired") return fail("This promotion has ended.", 409);
    // an admin's pause is moderation: only the team lifts it
    if (edit.op === "resume" && cur.pausedBy === "admin") return fail("Frenz paused this promotion. Contact support to resume it.", 403);
    const patch = edit.op === "pause" ? { paused: true, paused_by: "creator", paused_at: at, updated_at: at } : { paused: false, paused_by: null, paused_at: null, updated_at: at };
    const { error: uErr } = await db.from("sub_promotions").update(patch).eq("id", promotionId).eq("creator_id", creatorId);
    return uErr ? fail("Couldn't save the promotion.", 500) : { ok: true };
  }

  const s = await getSubSettings(creatorId);
  const counts = (await promotionCounts(db, [promotionId], now)).get(promotionId) ?? { redeemed: 0, live: 0, used: false };
  if (counts.used) {
    // price, durations and start belong to the checkouts already made: they stay as they are
    const same =
      edit.kind === cur.kind &&
      (edit.percentOff ?? null) === cur.percentOff &&
      (edit.fixedPriceCents ?? null) === cur.fixedPriceCents &&
      [...new Set(edit.durations)].sort((a, b) => a - b).join(",") === cur.durations.join(",") &&
      Date.parse(edit.startsAt) === Date.parse(cur.startsAt);
    if (!same) return fail("This promotion has already been used, so its price, durations and start date are locked. Pause it and create a new one instead.", 409);
    const max = edit.maxRedemptions ?? null;
    if (max !== null && max < counts.live) return fail(`The limit can't go below the ${counts.live} already redeemed or in checkout.`, 409);
  }
  const v = validatePromotion(edit, { monthlyCents: s.priceCents, bundles: s.bundlePrices, now, isNew: false });
  if (!v.ok) return fail(v.error);
  const { error: uErr } = await db.from("sub_promotions").update({ ...promotionRow(v.value), updated_at: at }).eq("id", promotionId).eq("creator_id", creatorId);
  return uErr ? fail("Couldn't save the promotion.", 500) : { ok: true };
}

// ─── admin ──────────────────────────────────────────────────────────────────

export interface AdminPromotionCreator {
  creatorId: string;
  handle: string | null;
  monthlyCents: number | null;
  bundlePrices: Record<string, number | null>;
  promotions: PromotionView[];
  /** verified purchases that used a promotion, newest first */
  purchases: { reference: string; promotionId: string; months: number; priceCents: number; totalCents: number; status: string; paidAt: string | null }[];
}

/** Admin → Memberships: one creator's bundle prices, promotions with their counts, and the purchases behind them. */
export async function adminCreatorPromotions(creator: string, now = Date.now()): Promise<{ ok: true; creator: AdminPromotionCreator } | Fail> {
  const db = createAdminClient();
  const q = creator.trim().replace(/^@/, "");
  if (!q) return fail("Give a creator's @handle or id.");
  const handle = q.toLowerCase();
  const { data: prof } = isUuid(q) ? await db.from("profiles").select("id, handle").eq("id", q).maybeSingle() : await db.from("profiles").select("id, handle").eq("handle", handle).maybeSingle();
  if (!prof) return fail("No creator with that handle.", 404);
  const creatorId = String((prof as Row).id);
  const [settings, promos] = await Promise.all([getSubSettings(creatorId), db.from("sub_promotions").select(PROMOTION_COLUMNS).eq("creator_id", creatorId).order("created_at", { ascending: false }).limit(MAX_PROMOTIONS)]);
  if (promos.error) return MISSING(promos.error.message) ? UNAVAILABLE : fail("Couldn't load promotions.", 500);
  const rows = (promos.data ?? []) as Row[];
  const items = await views(db, rows, now);
  const ids = items.map((p) => p.id);
  const { data: bought } = ids.length
    ? await db.from("sub_purchases").select("reference, promotion_id, months, price_cents, total_cents, status, paid_at").in("promotion_id", ids).in("status", ["paid", "refund_due", "refunded", "disputed", "reversed"]).order("paid_at", { ascending: false }).limit(200)
    : { data: [] };
  return {
    ok: true,
    creator: {
      creatorId,
      handle: ((prof as Row).handle as string | null) ?? null,
      monthlyCents: settings.priceCents,
      bundlePrices: { "3": settings.bundlePrices[3], "6": settings.bundlePrices[6], "12": settings.bundlePrices[12] },
      promotions: items,
      purchases: ((bought ?? []) as Row[]).map((r) => ({ reference: String(r.reference), promotionId: String(r.promotion_id), months: Number(r.months ?? 1), priceCents: Number(r.price_cents), totalCents: Number(r.total_cents), status: String(r.status), paidAt: (r.paid_at as string | null) ?? null })),
    },
  };
}

/** An admin pauses a promotion (moderation). Audited on the financial log with the admin's id and reason. */
export async function adminPausePromotion(adminId: string, promotionId: string, note: string, now = Date.now()): Promise<{ ok: true; changed: boolean } | Fail> {
  if (!isUuid(promotionId)) return fail("Not found.", 404);
  const db = createAdminClient();
  const { data, error } = await db.from("sub_promotions").select("id, creator_id, paused, paused_by").eq("id", promotionId).maybeSingle();
  if (error) return MISSING(error.message) ? UNAVAILABLE : fail("Couldn't pause it.", 500);
  if (!data) return fail("Not found.", 404);
  const row = data as Row;
  if (row.paused && row.paused_by === "admin") return { ok: true, changed: false };
  const at = new Date(now).toISOString();
  const { error: uErr } = await db.from("sub_promotions").update({ paused: true, paused_by: "admin", paused_at: at, updated_at: at }).eq("id", promotionId);
  if (uErr) return fail("Couldn't pause it.", 500);
  await db.from("financial_audit_log").insert({ actor_id: adminId, action: "sub_promotion_paused", target_type: "sub_promotion", target_id: promotionId, reference: null, details: { creator_id: row.creator_id, note, was_paused_by: row.paused_by ?? null } });
  return { ok: true, changed: true };
}
