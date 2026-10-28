import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { type AnalyticsPeriod, changePct, FEATURE_LABEL, PERIOD_DAYS } from "./format";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CREATOR ANALYTICS — ONE READ PER SECTION (the rebuilt dashboard, design/creator-analytics.html)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every figure is measured — from the creator's own rows or the database aggregates in 0297 — and every read is scoped
 * to the creator the route passes (the session). Nothing is estimated or filled in:
 *
 *   · a figure with no source is `null`, and its card is hidden behind FLAGS (lib/creator-analytics/flags.ts)
 *   · a change is null when the previous period has nothing to compare with
 *   · a source added by 0297 (locations, unfollows, dated downloads, the preview funnel) counts from the day it ships
 *   · money keeps its own unit: subscription earnings in USD cents, gift earnings in Gift Coin (FGC) minor units —
 *     never added together, never converted at a guessed rate
 *
 * Each section fails open per part: a missing table or function (before 0297 runs) gives that part null, the rest
 * still answers. The current period always ends now; the previous one is the same length just before it.
 */

type Db = ReturnType<typeof createAdminClient>;
type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : 0);

export interface DailyRow {
  day: string;
  views: number;
  unique: number;
  likes: number;
  saves: number;
  comments: number;
  shares: number;
  reposts: number;
  follows: number;
  unfollows: number;
  downloads: number;
  gifts: number;
  giftFgc: number;
}
const interactions = (d: DailyRow) => d.likes + d.saves + d.comments + d.shares + d.reposts;
const sumOf = (rows: DailyRow[], k: keyof Omit<DailyRow, "day">) => rows.reduce((s, r) => s + r[k], 0);

/** Midnight (UTC) `days` days ago — the same boundary the subscription aggregates use. */
export function since(days: number, now = Date.now()): string {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days + 1);
  return d.toISOString();
}

async function daily(db: Db, creator: string, days: number, tz: string): Promise<{ current: DailyRow[]; previous: DailyRow[] } | null> {
  const { data, error } = await db.rpc("creator_daily_metrics", { p_creator: creator, p_since: since(days * 2), p_tz: tz });
  if (error || !Array.isArray(data)) return null;
  const rows: DailyRow[] = (data as Row[]).map((r) => ({
    day: String(r.day).slice(0, 10),
    views: num(r.views),
    unique: num(r.unique),
    likes: num(r.likes),
    saves: num(r.saves),
    comments: num(r.comments),
    shares: num(r.shares),
    reposts: num(r.reposts),
    follows: num(r.follows),
    unfollows: num(r.unfollows),
    downloads: num(r.downloads),
    gifts: num(r.gifts),
    giftFgc: num(r.gift_fgc),
  }));
  return { current: rows.slice(-days), previous: rows.slice(0, Math.max(0, rows.length - days)) };
}

async function rpcJson<T>(db: Db, fn: string, args: Record<string, unknown>): Promise<T | null> {
  try {
    const { data, error } = await db.rpc(fn, args);
    return error ? null : ((data ?? null) as T | null);
  } catch {
    return null;
  }
}

async function followers(db: Db, creator: string): Promise<number | null> {
  const { data, error } = await db.from("profiles").select("followers_count").eq("id", creator).maybeSingle();
  return error ? null : num((data as Row | null)?.followers_count);
}

// ── subscriptions (Frenz Exclusive) ────────────────────────────────────────────

export interface SubPeriod {
  earnedCents: number;
  previousCents: number | null;
  newSubs: number;
  renewals: number;
  daily: { day: string; cents: number }[];
}

async function subPeriod(db: Db, creator: string, days: number): Promise<SubPeriod | null> {
  const [cur, dbl, dayR] = await Promise.all([
    db.rpc("sub_creator_summary", { p_creator: creator, p_since: since(days) }),
    db.rpc("sub_creator_summary", { p_creator: creator, p_since: since(days * 2) }),
    db.rpc("sub_creator_daily", { p_creator: creator, p_since: since(days) }),
  ]);
  if (cur.error || dayR.error) return null;
  const c = (cur.data ?? {}) as Row;
  const earned = num(c.earned_cents) - num(c.clawed_cents);
  const both = dbl.error ? null : num((dbl.data as Row | null)?.earned_cents) - num((dbl.data as Row | null)?.clawed_cents);
  return {
    earnedCents: earned,
    previousCents: both === null ? null : Math.max(0, both - earned),
    newSubs: num(c.new_subs),
    renewals: num(c.renewals),
    daily: ((dayR.data ?? []) as Row[]).map((d) => ({ day: String(d.day).slice(0, 10), cents: num(d.earned_cents) - num(d.clawed_cents) })),
  };
}

// ── gifts ─────────────────────────────────────────────────────────────────────

interface GiftRow { sender_id: string; recipient_share: number; created_at: string; sticker_snapshot: Row | null; sticker_id: string }

async function giftsSince(db: Db, creator: string, fromIso: string): Promise<GiftRow[] | null> {
  const { data, error } = await db.from("gift_sends").select("sender_id, recipient_share, created_at, sticker_snapshot, sticker_id").eq("recipient_id", creator).neq("status", "reversed").gte("created_at", fromIso).order("created_at", { ascending: true }).limit(20_000);
  return error ? null : ((data ?? []) as unknown as GiftRow[]);
}

const stickerName = (g: GiftRow) => (typeof g.sticker_snapshot?.name === "string" ? (g.sticker_snapshot.name as string) : "Sticker");

// ═════════════════════════════════════════════════════════════════════════════
//  OVERVIEW
// ═════════════════════════════════════════════════════════════════════════════

export interface Overview {
  period: AnalyticsPeriod;
  earnings: {
    subscriptions: { cents: number; change: number | null } | null;
    gifts: { fgc: number; change: number | null } | null;
    /** per day: the two series side by side, each in its own unit (never summed) */
    series: { day: string; cents: number; fgc: number }[];
  };
  social: { views: number; followers: number | null; engagementRate: number | null; newFollowers: number; likesShare: number | null; spark: number[] } | null;
  exclusive: { cents: number; change: number | null; weekly: number[]; newSubs: number; posts: number | null; subscribeRate: number | null } | null;
  gifting: { fgc: number; change: number | null; gifts: number; supporters: number; topSticker: string | null } | null;
  posts: { downloads: number; saves: number } | null;
  ai: { created: number; reposts: number } | null;
  feature: { key: string; name: string; share: number; month: string } | null;
  bestTime: { dow: number; block: number; share: number } | null;
}

export async function getOverview(creator: string, period: AnalyticsPeriod, tz: string): Promise<Overview> {
  const db = createAdminClient();
  const days = PERIOD_DAYS[period];
  const [d, sub, gifts, fol, postsR, preview, ai, feature, heat] = await Promise.all([
    daily(db, creator, days, tz),
    subPeriod(db, creator, days).catch(() => null),
    giftsSince(db, creator, since(days * 2)),
    followers(db, creator),
    db.from("sub_posts").select("id", { count: "exact", head: true }).eq("creator_id", creator).eq("status", "published"),
    db.from("sub_preview_events").select("viewer_id").eq("creator_id", creator).eq("kind", "preview_seen").gte("day", since(days).slice(0, 10)).limit(50_000),
    getAICreations(creator, period).catch(() => null),
    getFeatureOfMonth(creator).catch(() => null),
    rpcJson<{ dow: number; block: number; count: number }[]>(db, "creator_heatmap", { p_creator: creator, p_since: since(30), p_tz: tz }),
  ]);
  const cutoff = since(days);
  const curGifts = gifts?.filter((g) => g.created_at >= cutoff) ?? null;
  const prevGifts = gifts?.filter((g) => g.created_at < cutoff) ?? null;
  const fgc = curGifts?.reduce((s, g) => s + num(g.recipient_share), 0) ?? 0;
  const prevFgc = prevGifts?.reduce((s, g) => s + num(g.recipient_share), 0) ?? 0;

  const byDayCents = new Map((sub?.daily ?? []).map((x) => [x.day, x.cents]));
  const series = (d?.current ?? []).map((r) => ({ day: r.day, cents: byDayCents.get(r.day) ?? 0, fgc: r.giftFgc }));

  let social: Overview["social"] = null;
  if (d) {
    const views = sumOf(d.current, "views");
    const inter = d.current.reduce((s, r) => s + interactions(r), 0);
    social = {
      views,
      followers: fol,
      engagementRate: views > 0 ? (inter / views) * 100 : null,
      newFollowers: sumOf(d.current, "follows"),
      likesShare: inter > 0 ? (sumOf(d.current, "likes") / inter) * 100 : null,
      spark: d.current.map((r) => r.views),
    };
  }
  const previewViewers = preview.error ? null : new Set(((preview.data ?? []) as { viewer_id: string }[]).map((r) => r.viewer_id)).size;
  const exclusive: Overview["exclusive"] = sub
    ? {
        cents: sub.earnedCents,
        change: changePct(sub.earnedCents, sub.previousCents),
        weekly: weeks(sub.daily.map((x) => x.cents), 8),
        newSubs: sub.newSubs,
        posts: postsR.error ? null : (postsR.count ?? 0),
        subscribeRate: previewViewers ? (sub.newSubs / previewViewers) * 100 : null,
      }
    : null;
  const counts = new Map<string, number>();
  for (const g of curGifts ?? []) counts.set(stickerName(g), (counts.get(stickerName(g)) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    period,
    earnings: {
      subscriptions: sub ? { cents: sub.earnedCents, change: changePct(sub.earnedCents, sub.previousCents) } : null,
      gifts: gifts ? { fgc, change: changePct(fgc, prevFgc) } : null,
      series,
    },
    social,
    exclusive,
    gifting: curGifts ? { fgc, change: changePct(fgc, prevFgc), gifts: curGifts.length, supporters: new Set(curGifts.map((g) => g.sender_id)).size, topSticker: top } : null,
    posts: d ? { downloads: sumOf(d.current, "downloads"), saves: sumOf(d.current, "saves") } : null,
    ai: ai ? { created: ai.created, reposts: ai.reposts } : null,
    feature: feature?.winner ? { key: feature.winner.key, name: feature.winner.name, share: feature.winner.share, month: feature.month } : null,
    bestTime: bestTime(heat),
  };
}

/** The busiest 4-hour block of the last 30 days — only with enough views to mean something (≥ 50, and ≥ 1.5× an even spread). */
export function bestTime(heat: { dow: number; block: number; count: number }[] | null): Overview["bestTime"] {
  if (!heat?.length) return null;
  const total = heat.reduce((s, h) => s + num(h.count), 0);
  if (total < 50) return null;
  const peak = [...heat].sort((a, b) => num(b.count) - num(a.count))[0]!;
  const share = num(peak.count) / total;
  return share >= 1.5 / 42 ? { dow: peak.dow, block: peak.block, share: share * 100 } : null;
}

/** Sum a daily series into its last `n` 7-day weeks (oldest first). */
export function weeks(values: number[], n: number): number[] {
  const out: number[] = [];
  for (let end = values.length; end > 0 && out.length < n; end -= 7) out.unshift(values.slice(Math.max(0, end - 7), end).reduce((s, v) => s + v, 0));
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
//  SOCIAL · VIEWS · AUDIENCE
// ═════════════════════════════════════════════════════════════════════════════

export interface Social {
  period: AnalyticsPeriod;
  engagementRate: number | null;
  rateChange: number | null;
  interactions: number;
  views: number;
  rateSeries: number[];
  likes: { n: number; change: number | null };
  comments: { n: number; change: number | null };
  shares: { n: number; change: number | null };
  viewsSpark: number[];
  followersSpark: number[];
  newFollowers: number;
  mix: { likes: number; saves: number; comments: number; shares: number; reposts: number };
  topPosts: { id: string; title: string; thumbnailUrl: string | null; views: number; interactions: number; rate: number }[] | null;
}

export async function getSocial(creator: string, period: AnalyticsPeriod, tz: string): Promise<Social | null> {
  const db = createAdminClient();
  const days = PERIOD_DAYS[period];
  const [d, top] = await Promise.all([daily(db, creator, days, tz), rpcJson<Row[]>(db, "creator_top_engaging", { p_creator: creator, p_since: since(days), p_limit: 5 })]);
  if (!d) return null;
  const c = d.current;
  const p = d.previous;
  const views = sumOf(c, "views");
  const inter = c.reduce((s, r) => s + interactions(r), 0);
  const pViews = sumOf(p, "views");
  const pInter = p.reduce((s, r) => s + interactions(r), 0);
  const rate = views > 0 ? (inter / views) * 100 : null;
  const pRate = pViews > 0 ? (pInter / pViews) * 100 : null;
  const comp = (k: keyof Omit<DailyRow, "day">) => ({ n: sumOf(c, k), change: changePct(sumOf(c, k), sumOf(p, k)) });
  return {
    period,
    engagementRate: rate,
    rateChange: rate !== null && pRate ? rate - pRate : null,
    interactions: inter,
    views,
    rateSeries: c.map((r) => (r.views > 0 ? (interactions(r) / r.views) * 100 : 0)),
    likes: comp("likes"),
    comments: comp("comments"),
    shares: { n: sumOf(c, "shares") + sumOf(c, "reposts"), change: changePct(sumOf(c, "shares") + sumOf(c, "reposts"), sumOf(p, "shares") + sumOf(p, "reposts")) },
    viewsSpark: c.map((r) => r.views),
    followersSpark: c.map((r) => r.follows - r.unfollows),
    newFollowers: sumOf(c, "follows"),
    mix: { likes: sumOf(c, "likes"), saves: sumOf(c, "saves"), comments: sumOf(c, "comments"), shares: sumOf(c, "shares"), reposts: sumOf(c, "reposts") },
    topPosts: top
      ? top.map((t) => ({ id: String(t.id), title: String(t.title ?? "Post"), thumbnailUrl: typeof t.thumbnail_url === "string" ? t.thumbnail_url : null, views: num(t.views), interactions: num(t.interactions), rate: num(t.views) > 0 ? (num(t.interactions) / num(t.views)) * 100 : 0 }))
      : null,
  };
}

export interface Views {
  period: AnalyticsPeriod;
  total: number;
  change: number | null;
  /** one bar per day (7D, 30D) or per week (90D, 1Y) */
  bars: { day: string; views: number }[];
  per: "day" | "week";
  average: number;
  peak: { day: string; views: number } | null;
  unique: number | null;
  sources: { source: string; count: number }[] | null;
}

export async function getViews(creator: string, period: AnalyticsPeriod, tz: string): Promise<Views | null> {
  const db = createAdminClient();
  const days = PERIOD_DAYS[period];
  const [d, uv, src] = await Promise.all([
    daily(db, creator, days, tz),
    rpcJson<Row>(db, "creator_unique_viewers", { p_creator: creator, p_since: since(days) }),
    rpcJson<Row[]>(db, "creator_view_sources", { p_creator: creator, p_since: since(days) }),
  ]);
  if (!d) return null;
  const total = sumOf(d.current, "views");
  const per = days > 30 ? "week" : "day";
  const bars =
    per === "day"
      ? d.current.map((r) => ({ day: r.day, views: r.views }))
      : (() => {
          const out: { day: string; views: number }[] = [];
          for (let i = 0; i < d.current.length; i += 7) {
            const part = d.current.slice(i, i + 7);
            out.push({ day: part[0]!.day, views: part.reduce((s, r) => s + r.views, 0) });
          }
          return out;
        })();
  const peakDay = d.current.reduce<DailyRow | null>((b, r) => (!b || r.views > b.views ? r : b), null);
  return {
    period,
    total,
    change: changePct(total, sumOf(d.previous, "views")),
    bars,
    per,
    average: bars.length ? total / bars.length : 0,
    peak: peakDay && peakDay.views > 0 ? { day: peakDay.day, views: peakDay.views } : null,
    unique: uv ? num(uv.unique) : null,
    sources: src ? src.map((s) => ({ source: String(s.source), count: num(s.count) })) : null,
  };
}

export interface Audience {
  followers: number | null;
  newThisMonth: number;
  unfollowed: number;
  /** cumulative followers at the end of each of the last 30 days, walked back from today's total */
  growth: number[];
  followingShare: number | null;
  locations: { countries: { name: string; count: number }[]; cities: { name: string; count: number }[] } | null;
  heatmap: number[][] | null;
}

export async function getAudience(creator: string, tz: string): Promise<Audience | null> {
  const db = createAdminClient();
  const [d, fol, uv, countries, cities, heat] = await Promise.all([
    daily(db, creator, 30, tz),
    followers(db, creator),
    rpcJson<Row>(db, "creator_unique_viewers", { p_creator: creator, p_since: since(30) }),
    rpcJson<Row[]>(db, "creator_locations", { p_creator: creator, p_since: since(90), p_kind: "country" }),
    rpcJson<Row[]>(db, "creator_locations", { p_creator: creator, p_since: since(90), p_kind: "city" }),
    rpcJson<{ dow: number; block: number; count: number }[]>(db, "creator_heatmap", { p_creator: creator, p_since: since(30), p_tz: tz }),
  ]);
  if (!d) return null;
  const growth: number[] = [];
  let level = fol ?? 0;
  for (let i = d.current.length - 1; i >= 0; i--) {
    growth.unshift(level);
    level = level - d.current[i]!.follows + d.current[i]!.unfollows;
  }
  const grid = Array.from({ length: 7 }, () => Array<number>(6).fill(0));
  for (const h of heat ?? []) if (h.dow >= 0 && h.dow < 7 && h.block >= 0 && h.block < 6) grid[h.dow]![h.block] = num(h.count);
  const signedIn = uv ? num(uv.signed_in) : 0;
  const loc = (rows: Row[] | null) => (rows ?? []).map((r) => ({ name: String(r.name), count: num(r.count) }));
  return {
    followers: fol,
    newThisMonth: sumOf(d.current, "follows"),
    unfollowed: sumOf(d.current, "unfollows"),
    growth,
    followingShare: uv && signedIn > 0 ? (num(uv.following) / signedIn) * 100 : null,
    locations: countries || cities ? { countries: loc(countries), cities: loc(cities) } : null,
    heatmap: heat ? grid : null,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
//  EXCLUSIVE (subscriptions) · GIFTING
// ═════════════════════════════════════════════════════════════════════════════

export interface Exclusive {
  period: AnalyticsPeriod;
  cents: number;
  change: number | null;
  /** the last 8 weeks, oldest first — the current week last */
  weekly: number[];
  newSubs: number;
  renewals: number;
  activeSubscribers: number | null;
  averageCents: number | null;
  funnel: { previewViewers: number; tapped: number; subscribed: number } | null;
  topPosts: { id: string; kind: string; views: number; thumb: string | null; postedAt: string }[] | null;
  repeatShare: number | null;
}

export async function getExclusive(creator: string, period: AnalyticsPeriod): Promise<Exclusive | null> {
  const db = createAdminClient();
  const days = PERIOD_DAYS[period];
  const fromDay = since(days).slice(0, 10);
  const [sub, eight, active, seen, tapped, top] = await Promise.all([
    subPeriod(db, creator, days),
    db.rpc("sub_creator_daily", { p_creator: creator, p_since: since(56) }),
    db.from("creator_memberships").select("id", { count: "exact", head: true }).eq("creator_id", creator).eq("billing", "sub").eq("status", "active").gt("period_end", new Date().toISOString()),
    db.from("sub_preview_events").select("viewer_id").eq("creator_id", creator).eq("kind", "preview_seen").gte("day", fromDay).limit(50_000),
    db.from("sub_preview_events").select("viewer_id").eq("creator_id", creator).eq("kind", "subscribe_tapped").gte("day", fromDay).limit(50_000),
    import("@/lib/sub/visits").then((m) => m.topSubPostsSince(creator, since(days), 6)).catch(() => null),
  ]);
  if (!sub) return null;
  const paid = sub.newSubs + sub.renewals;
  const seenN = seen.error ? null : new Set(((seen.data ?? []) as { viewer_id: string }[]).map((r) => r.viewer_id)).size;
  const tappedN = tapped.error ? null : new Set(((tapped.data ?? []) as { viewer_id: string }[]).map((r) => r.viewer_id)).size;
  return {
    period,
    cents: sub.earnedCents,
    change: changePct(sub.earnedCents, sub.previousCents),
    weekly: eight.error ? [] : weeks(((eight.data ?? []) as Row[]).map((r) => num(r.earned_cents) - num(r.clawed_cents)), 8),
    newSubs: sub.newSubs,
    renewals: sub.renewals,
    activeSubscribers: active.error ? null : (active.count ?? 0),
    averageCents: paid > 0 ? sub.earnedCents / paid : null,
    funnel: seenN !== null && tappedN !== null && seenN > 0 ? { previewViewers: seenN, tapped: tappedN, subscribed: sub.newSubs } : null,
    topPosts: top ? top.map((t) => ({ id: t.id, kind: t.kind, views: t.views, thumb: t.thumb, postedAt: t.postedAt })) : null,
    repeatShare: paid > 0 ? (sub.renewals / paid) * 100 : null,
  };
}

export interface Gifting {
  period: AnalyticsPeriod;
  fgc: number;
  change: number | null;
  gifts: number;
  supporters: number;
  monthly: { month: string; fgc: number }[];
  bySticker: { name: string; imageUrl: string | null; gifts: number; fgc: number }[];
  topSupporters: { id: string; name: string; handle: string | null; avatarUrl: string | null; gifts: number; fgc: number }[];
}

export async function getGifting(creator: string, period: AnalyticsPeriod): Promise<Gifting | null> {
  const db = createAdminClient();
  const days = PERIOD_DAYS[period];
  const from = new Date(Math.min(Date.parse(since(days * 2)), Date.parse(since(186))));
  const rows = await giftsSince(db, creator, from.toISOString());
  if (!rows) return null;
  const cutoff = since(days);
  const prevCut = since(days * 2);
  const cur = rows.filter((g) => g.created_at >= cutoff);
  const prev = rows.filter((g) => g.created_at >= prevCut && g.created_at < cutoff);
  const fgc = cur.reduce((s, g) => s + num(g.recipient_share), 0);
  const months: { month: string; fgc: number }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const m = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = m.toISOString().slice(0, 7);
    months.push({ month: key, fgc: rows.filter((g) => g.created_at.slice(0, 7) === key).reduce((s, g) => s + num(g.recipient_share), 0) });
  }
  const stickers = new Map<string, { name: string; imageUrl: string | null; gifts: number; fgc: number }>();
  const people = new Map<string, { gifts: number; fgc: number }>();
  for (const g of cur) {
    const name = stickerName(g);
    const s = stickers.get(g.sticker_id) ?? { name, imageUrl: typeof g.sticker_snapshot?.image_url === "string" ? (g.sticker_snapshot.image_url as string) : null, gifts: 0, fgc: 0 };
    s.gifts++;
    s.fgc += num(g.recipient_share);
    stickers.set(g.sticker_id, s);
    const p = people.get(g.sender_id) ?? { gifts: 0, fgc: 0 };
    p.gifts++;
    p.fgc += num(g.recipient_share);
    people.set(g.sender_id, p);
  }
  const topIds = [...people.entries()].sort((a, b) => b[1].fgc - a[1].fgc).slice(0, 5);
  const prof = topIds.length ? await db.from("profiles").select("id, display_name, handle, avatar_url").in("id", topIds.map(([id]) => id)) : { data: [] };
  const byId = new Map(((prof.data ?? []) as Row[]).map((p) => [String(p.id), p]));
  return {
    period,
    fgc,
    change: changePct(fgc, prev.reduce((s, g) => s + num(g.recipient_share), 0)),
    gifts: cur.length,
    supporters: people.size,
    monthly: months,
    bySticker: [...stickers.values()].sort((a, b) => b.fgc - a.fgc).slice(0, 8),
    topSupporters: topIds.map(([id, v]) => {
      const p = byId.get(id);
      const handle = typeof p?.handle === "string" ? p.handle : null;
      return { id, name: (typeof p?.display_name === "string" && p.display_name) || (handle ? `@${handle}` : "A member"), handle, avatarUrl: typeof p?.avatar_url === "string" ? p.avatar_url : null, ...v };
    }),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
//  POSTS (the design's "Wallpapers") · ONE POST
// ═════════════════════════════════════════════════════════════════════════════

export const POST_SORTS = ["views", "downloads", "saves", "newest"] as const;
export type PostSort = (typeof POST_SORTS)[number];
export const POSTS_PAGE = 20;

export interface PostsPage {
  totals: { posts: number; downloads: number; saves: number; views: number };
  items: { id: string; title: string; thumbnailUrl: string | null; createdAt: string; views: number; downloads: number; saves: number }[];
  next: number | null;
}

export async function getPosts(creator: string, sort: PostSort, page: number, query: string): Promise<PostsPage | null> {
  const db = createAdminClient();
  const col = sort === "newest" ? "created_at" : `${sort}_count`;
  let q = db.from("posts").select("id, title, thumbnail_url, created_at, views_count, downloads_count, saves_count").eq("publisher_id", creator).neq("status", "removed");
  const term = query.replace(/[%_,()]/g, " ").trim().slice(0, 60);
  if (term) q = q.ilike("title", `%${term}%`);
  const from = Math.max(0, page) * POSTS_PAGE;
  const [list, all] = await Promise.all([
    q.order(col, { ascending: false }).order("id", { ascending: false }).range(from, from + POSTS_PAGE),
    db.from("posts").select("views_count, downloads_count, saves_count").eq("publisher_id", creator).neq("status", "removed").limit(5000),
  ]);
  if (list.error) return null;
  const rows = (list.data ?? []) as Row[];
  const allRows = (all.data ?? []) as Row[];
  return {
    totals: { posts: allRows.length, downloads: allRows.reduce((s, r) => s + num(r.downloads_count), 0), saves: allRows.reduce((s, r) => s + num(r.saves_count), 0), views: allRows.reduce((s, r) => s + num(r.views_count), 0) },
    items: rows.slice(0, POSTS_PAGE).map((r) => ({ id: String(r.id), title: String(r.title ?? "Post"), thumbnailUrl: typeof r.thumbnail_url === "string" ? r.thumbnail_url : null, createdAt: String(r.created_at), views: num(r.views_count), downloads: num(r.downloads_count), saves: num(r.saves_count) })),
    next: rows.length > POSTS_PAGE ? page + 1 : null,
  };
}

export interface PostInsights {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  createdAt: string;
  slugPath: string;
  rank: number | null;
  vsAverage: number | null;
  metrics: { views: number; downloads: number; saves: number; shares: number; engagementRate: number | null; avgWatchMs: number | null };
  curve: { day: number; post: number; average: number }[];
  funnel: { viewed: number; opened: number; downloaded: number } | null;
}

export async function getPostInsights(creator: string, postId: string): Promise<PostInsights | null> {
  const db = createAdminClient();
  const [{ data: post }, curve] = await Promise.all([
    db.from("posts").select("id, title, thumbnail_url, created_at, views_count, downloads_count, saves_count, shares_count, likes_count, comments_count").eq("id", postId).eq("publisher_id", creator).maybeSingle(),
    rpcJson<Row>(db, "creator_post_curve", { p_creator: creator, p_post: postId }),
  ]);
  const p = post as Row | null;
  if (!p) return null;
  const views = num(p.views_count);
  const inter = num(p.likes_count) + num(p.saves_count) + num(p.shares_count) + num(p.comments_count);
  const postC = new Map(((curve?.post ?? []) as Row[]).map((r) => [num(r.day), num(r.views)]));
  const avgC = new Map(((curve?.average ?? []) as Row[]).map((r) => [num(r.day), num(r.views)]));
  const maxDay = Math.min(30, Math.floor((Date.now() - Date.parse(String(p.created_at))) / 864e5));
  const series: PostInsights["curve"] = [];
  let a = 0;
  let b = 0;
  for (let i = 0; i <= Math.max(0, maxDay); i++) {
    a += postC.get(i) ?? 0;
    b += avgC.get(i) ?? 0;
    series.push({ day: i, post: a, average: Math.round(b * 10) / 10 });
  }
  const creatorAvg = curve ? num(curve.creator_avg_views) : 0;
  const opened = curve ? num(curve.opened) : 0;
  return {
    id: String(p.id),
    title: String(p.title ?? "Post"),
    thumbnailUrl: typeof p.thumbnail_url === "string" ? p.thumbnail_url : null,
    createdAt: String(p.created_at),
    slugPath: `/p/${String(p.id)}`,
    rank: curve ? num(curve.rank) : null,
    vsAverage: creatorAvg > 0 ? views / creatorAvg : null,
    metrics: { views, downloads: num(p.downloads_count), saves: num(p.saves_count), shares: num(p.shares_count), engagementRate: views > 0 ? (inter / views) * 100 : null, avgWatchMs: curve && curve.avg_watch_ms !== null ? num(curve.avg_watch_ms) || null : null },
    curve: curve ? series : [],
    funnel: curve && views > 0 ? { viewed: views, opened, downloaded: num(curve.downloads_dated) } : null,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
//  AI CREATIONS · FEATURE OF THE MONTH
// ═════════════════════════════════════════════════════════════════════════════

export interface AICreations {
  period: AnalyticsPeriod;
  created: number;
  createdChange: number | null;
  published: number;
  publishedChange: number | null;
  reposts: number;
  repostsChange: number | null;
  viewShare: number | null;
  weekly: { created: number; published: number }[];
  styles: { feature: string; n: number }[];
  mostReposted: { id: string; title: string; thumbnailUrl: string | null; reposts: number }[];
}

const FEATURE_NAME: Record<string, string> = {
  image_to_video: "Image to video",
  text_to_video: "Text to video",
  character_replace: "Character replace",
  lip_sync: "Lip sync",
  text_to_audio: "Text to audio",
  voice_clone: "Voice clone",
  clean: "Clean up",
};
export const aiFeatureName = (f: string) => FEATURE_NAME[f] ?? f.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export async function getAICreations(creator: string, period: AnalyticsPeriod): Promise<AICreations | null> {
  const db = createAdminClient();
  const days = PERIOD_DAYS[period];
  const from2 = since(days * 2);
  const cut = since(days);
  const [jobs, posts] = await Promise.all([
    db.from("ai_jobs").select("id, feature, status, created_at").eq("user_id", creator).gte("created_at", from2).limit(20_000),
    db.from("posts").select("id, title, thumbnail_url, created_at, views_count, reposts_count, ai_job_id").eq("publisher_id", creator).not("ai_job_id", "is", null).neq("status", "removed").limit(2000),
  ]);
  if (jobs.error) return null;
  // a creation = an AI job that finished (0141 statuses: completed is the only success)
  const all = ((jobs.data ?? []) as Row[]).filter((j) => j.status === "completed");
  const cur = all.filter((j) => String(j.created_at) >= cut);
  const aiPosts = posts.error ? [] : ((posts.data ?? []) as Row[]);
  const pubCur = aiPosts.filter((p) => String(p.created_at) >= cut).length;
  const pubPrev = aiPosts.filter((p) => String(p.created_at) >= from2 && String(p.created_at) < cut).length;
  const ids = aiPosts.map((p) => String(p.id));
  const [rp, vAi] = await Promise.all([
    ids.length ? db.from("reposts").select("post_id, created_at, user_id").in("post_id", ids).gte("created_at", from2).neq("user_id", creator).limit(20_000) : Promise.resolve({ data: [], error: null }),
    ids.length ? db.from("post_views").select("id", { count: "exact", head: true }).in("post_id", ids).gte("created_at", cut) : Promise.resolve({ count: 0, error: null }),
  ]);
  const reposts = ((rp.data ?? []) as Row[]);
  const rCur = reposts.filter((r) => String(r.created_at) >= cut).length;
  const rPrev = reposts.length - rCur;
  const d = await daily(db, creator, days, "UTC");
  const totalViews = d ? sumOf(d.current, "views") : 0;
  const weekly: { created: number; published: number }[] = [];
  const weeksN = Math.min(8, Math.ceil(days / 7));
  for (let w = weeksN - 1; w >= 0; w--) {
    const end = Date.now() - w * 7 * 864e5;
    const start = end - 7 * 864e5;
    const inW = (iso: unknown) => Date.parse(String(iso)) >= start && Date.parse(String(iso)) < end;
    weekly.push({ created: all.filter((j) => inW(j.created_at)).length, published: aiPosts.filter((p) => inW(p.created_at)).length });
  }
  const styles = new Map<string, number>();
  for (const j of cur) styles.set(String(j.feature), (styles.get(String(j.feature)) ?? 0) + 1);
  const repostCount = new Map<string, number>();
  for (const r of reposts.filter((x) => String(x.created_at) >= cut)) repostCount.set(String(r.post_id), (repostCount.get(String(r.post_id)) ?? 0) + 1);
  return {
    period,
    created: cur.length,
    createdChange: changePct(cur.length, all.length - cur.length),
    published: pubCur,
    publishedChange: changePct(pubCur, pubPrev),
    reposts: rCur,
    repostsChange: changePct(rCur, rPrev),
    viewShare: totalViews > 0 && !vAi.error ? ((vAi.count ?? 0) / totalViews) * 100 : null,
    weekly,
    styles: [...styles.entries()].map(([feature, n]) => ({ feature: aiFeatureName(feature), n })).sort((a, b) => b.n - a.n).slice(0, 5),
    mostReposted: aiPosts
      .filter((p) => repostCount.has(String(p.id)))
      .map((p) => ({ id: String(p.id), title: String(p.title ?? "AI creation"), thumbnailUrl: typeof p.thumbnail_url === "string" ? p.thumbnail_url : null, reposts: repostCount.get(String(p.id)) ?? 0 }))
      .sort((a, b) => b.reposts - a.reposts)
      .slice(0, 5),
  };
}

export interface FeatureMonth {
  month: string; // YYYY-MM
  audience: number;
  ranking: { key: string; name: string; users: number; share: number; rankChange: number | null }[];
  winner: { key: string; name: string; share: number } | null;
  giftsToCreator: { gifts: number; fgc: number } | null;
  pastWinners: { month: string; key: string; name: string; share: number }[];
}

const monthStart = (y: number, m: number) => new Date(Date.UTC(y, m, 1)).toISOString();

async function usage(db: Db, creator: string, y: number, m: number): Promise<{ audience: number; features: Record<string, number> } | null> {
  const r = await rpcJson<{ audience: number; features: Record<string, number> }>(db, "creator_feature_usage", { p_creator: creator, p_from: monthStart(y, m), p_to: monthStart(y, m + 1) });
  return r ? { audience: num(r.audience), features: Object.fromEntries(Object.entries(r.features ?? {}).map(([k, v]) => [k, num(v)])) } : null;
}

const rankOf = (u: { audience: number; features: Record<string, number> }) =>
  Object.entries(u.features)
    .map(([key, users]) => ({ key, users, share: u.audience > 0 ? (users / u.audience) * 100 : 0 }))
    .sort((a, b) => b.users - a.users || a.key.localeCompare(b.key));

export async function getFeatureOfMonth(creator: string, now = new Date()): Promise<FeatureMonth | null> {
  const db = createAdminClient();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const months = await Promise.all([0, 1, 2, 3].map((i) => usage(db, creator, y, m - i)));
  const cur = months[0];
  if (!cur) return null;
  const ranked = rankOf(cur);
  const prevRank = months[1] ? new Map(rankOf(months[1]).map((r, i) => [r.key, i])) : null;
  const top = ranked[0] && ranked[0].users > 0 ? ranked[0] : null;
  const gifts = top?.key === "sticker_gifts" ? await giftsSince(db, creator, monthStart(y, m)) : null;
  return {
    month: monthStart(y, m).slice(0, 7),
    audience: cur.audience,
    ranking: ranked.map((r, i) => ({ key: r.key, name: FEATURE_LABEL[r.key] ?? r.key, users: r.users, share: r.share, rankChange: prevRank?.has(r.key) ? prevRank.get(r.key)! - i : null })),
    winner: top ? { key: top.key, name: FEATURE_LABEL[top.key] ?? top.key, share: top.share } : null,
    giftsToCreator: gifts ? { gifts: gifts.length, fgc: gifts.reduce((s, g) => s + num(g.recipient_share), 0) } : null,
    pastWinners: months
      .slice(1)
      .map((u, i) => {
        const r = u ? rankOf(u)[0] : null;
        return r && r.users > 0 ? { month: monthStart(y, m - 1 - i).slice(0, 7), key: r.key, name: FEATURE_LABEL[r.key] ?? r.key, share: r.share } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x),
  };
}
