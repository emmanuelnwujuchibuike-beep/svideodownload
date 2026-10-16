import "server-only";

import { subscriptionCharge } from "@/lib/creator/membership/engine";
import { flagsOf, isAccountVisibleTo } from "@/lib/social/account-visibility";
import { hasPrivateR2, presignPrivateGet } from "@/lib/storage/r2";
import { createAdminClient } from "@/lib/supabase/admin";

import { afterCursorFilter, audienceOf, decodeSubCursor, encodeSubCursor, isUuid } from "./guards";
import { subConfig } from "./server";

/**
 * The Exclusive feed (Frenz Exclusive Part 3, 2026-10-16).
 *
 * ── What it is ──────────────────────────────────────────────────────────────
 * Exclusive posts from every creator the viewer ACTIVELY subscribes to, newest first, in one
 * list — read from `sub_posts` itself (no second post table). Below it, on the first page
 * only, "discover": LOCKED previews from creators the viewer follows but does not subscribe
 * to, each with the creator's current price and the existing checkout.
 *
 * ── Who may see what (every request, on the server) ─────────────────────────
 *  · Subscriptions are read ONCE per page, in a batch: an active, paid, unexpired membership
 *    (the same predicate as `hasActiveSub`), minus creators who blocked the viewer or whom the
 *    viewer blocked, minus suspended or hidden accounts. A refund, a removal, an expiry or a
 *    block takes a creator out of the very next page.
 *  · Only `status = 'published'` posts: a takedown (Part 2, archived) leaves the feed at once.
 *  · Subscribers see their creators' hidden posts too — that is what they paid for.
 *  · Discover is built from `audience = 'locked'` rows only, filtered in the query: a hidden
 *    post of a creator the viewer does not subscribe to never leaves the database.
 *
 * ── What a card carries ─────────────────────────────────────────────────────
 * Feed card: id, creator, date, caption, item count, has-video, and ONE five-minute link to
 * the first item's small preview (thumb, else the first photo). Never a storage key, never
 * every item's link: opening a post goes through /api/sub/posts/[id], which checks access
 * again and signs the media then. Discover card: id, creator, date, the PUBLIC cover (if the
 * creator set one), item count, has-video — never a caption, never a private link.
 *
 * ── Paging ──────────────────────────────────────────────────────────────────
 * Keyset on (created_at desc, id desc): the cursor is the last row returned, so a post added
 * while scrolling never shifts a page, and a tie on created_at never skips or repeats a post.
 * PAGE + 1 rows are read to know whether there is a next page.
 */

type Row = Record<string, unknown>;
const MISSING = (m: string) => /schema cache|does not exist|column/i.test(m);
export const FEED_PAGE = 12;
/** at most this many subscribed creators feed one page (an `in (…)` list must fit in a request URL) */
export const FEED_MAX_CREATORS = 150;
const DISCOVER_FOLLOWS = 200;
const DISCOVER_CARDS = 8;
const SIGNED_TTL_SECONDS = 300;

export interface FeedCreator {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string | null;
  verified: boolean;
}

export interface FeedPost {
  id: string;
  creatorId: string;
  createdAt: string;
  caption: string | null;
  items: number;
  hasVideo: boolean;
  /** a five-minute link to the first item's small preview; null for a video with no preview yet */
  previewUrl: string | null;
  hidden: boolean;
}

export interface DiscoverCard {
  id: string;
  creatorId: string;
  createdAt: string;
  /** the creator's PUBLIC teaser image (their choice); null = a plain locked tile */
  coverUrl: string | null;
  items: number;
  hasVideo: boolean;
}

export interface DiscoverCreator extends FeedCreator {
  /** what a subscription costs now — the server's numbers, the same ones checkout charges */
  priceCents: number;
  totalCents: number;
  periodDays: number;
}

export interface ExclusiveFeedPage {
  posts: FeedPost[];
  creators: Record<string, FeedCreator>;
  next: string | null;
  /** how many creators the viewer actively subscribes to (0 = show the empty state) */
  subscriptions: number;
  /** first page only */
  discover?: { cards: DiscoverCard[]; creators: Record<string, DiscoverCreator> };
  ready: boolean;
}

type Fail = { ok: false; error: string; status: number };

/** Creators this viewer may see exclusive posts of right now: one batched read, the `hasActiveSub` predicate. */
export async function activeSubscriptions(viewerId: string): Promise<{ ids: string[]; ready: boolean }> {
  if (!isUuid(viewerId)) return { ids: [], ready: true };
  const db = createAdminClient();
  const [subs, blocks] = await Promise.all([
    db.from("creator_memberships").select("creator_id").eq("member_id", viewerId).eq("status", "active").eq("billing", "sub").gt("period_end", new Date().toISOString()).order("period_end", { ascending: false }).limit(FEED_MAX_CREATORS),
    db.from("blocks").select("blocker_id, blocked_id").or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`).limit(5000),
  ]);
  // a failed read is "no access": paid content fails CLOSED
  if (subs.error || blocks.error) return { ids: [], ready: !subs.error || !MISSING(subs.error.message) };
  const blocked = new Set(((blocks.data ?? []) as Row[]).map((b) => (b.blocker_id === viewerId ? b.blocked_id : b.blocker_id) as string));
  return { ids: [...new Set(((subs.data ?? []) as Row[]).map((s) => s.creator_id as string))].filter((id) => id !== viewerId && !blocked.has(id)), ready: true };
}

async function creatorsById(ids: string[]): Promise<Map<string, FeedCreator>> {
  const out = new Map<string, FeedCreator>();
  if (!ids.length) return out;
  const { data } = await createAdminClient().from("profiles").select("id, handle, display_name, avatar_url, is_verified, is_suspended, is_hidden").in("id", ids);
  for (const p of (data ?? []) as Row[]) {
    // a suspended or hidden account's exclusive posts leave the feed with the account
    if (!p.handle || !isAccountVisibleTo(flagsOf(p), "stranger")) continue;
    out.set(p.id as string, { id: p.id as string, handle: p.handle as string, name: ((p.display_name as string | null) || `@${p.handle as string}`).slice(0, 60), avatarUrl: (p.avatar_url as string | null) ?? null, verified: !!p.is_verified });
  }
  return out;
}

/** Counts and the first item of each post — one read for the whole page. */
async function mediaOf(postIds: string[], withKeys: boolean): Promise<Map<string, { n: number; video: boolean; first: Row | null }>> {
  const out = new Map<string, { n: number; video: boolean; first: Row | null }>();
  if (!postIds.length) return out;
  const db = createAdminClient();
  const cols = withKeys ? "post_id, idx, media_kind, object_key, thumb_key" : "post_id, idx, media_kind";
  let res = await db.from("sub_post_media").select(cols).in("post_id", postIds).order("idx");
  if (res.error && withKeys && MISSING(res.error.message)) res = (await db.from("sub_post_media").select("post_id, idx, media_kind, object_key").in("post_id", postIds).order("idx")) as typeof res;
  for (const m of (res.data ?? []) as unknown as Row[]) {
    const c = out.get(m.post_id as string) ?? { n: 0, video: false, first: null };
    c.n++;
    if (m.media_kind === "video") c.video = true;
    if (!c.first || Number(m.idx) < Number(c.first.idx)) c.first = m;
    out.set(m.post_id as string, c);
  }
  return out;
}

/** The feed page for a signed-in viewer. `cursor` is the previous page's `next`. */
export async function exclusiveFeed(viewerId: string, cursor?: string | null): Promise<({ ok: true } & ExclusiveFeedPage) | Fail> {
  if (!isUuid(viewerId)) return { ok: false, error: "Sign in to see your exclusive feed.", status: 401 };
  const c = decodeSubCursor(cursor);
  if (c === "invalid") return { ok: false, error: "Bad cursor.", status: 400 };
  const db = createAdminClient();
  const subs = await activeSubscriptions(viewerId);
  const creators = await creatorsById(subs.ids);
  const allowed = [...creators.keys()];

  let posts: FeedPost[] = [];
  let next: string | null = null;
  if (allowed.length) {
    const read = (withAudience: boolean) => {
      let q = db
        .from("sub_posts")
        .select(withAudience ? "id, creator_id, caption, created_at, audience" : "id, creator_id, caption, created_at")
        .in("creator_id", allowed)
        .eq("status", "published")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(FEED_PAGE + 1);
      if (c) q = c.id ? q.or(afterCursorFilter({ at: c.at, id: c.id })) : q.lt("created_at", c.at);
      return q;
    };
    let res = await read(true);
    if (res.error && MISSING(res.error.message)) res = await read(false);
    if (res.error) return { ok: true, posts: [], creators: {}, next: null, subscriptions: allowed.length, ready: false };
    const rows = (res.data ?? []) as unknown as Row[];
    const page = rows.slice(0, FEED_PAGE);
    const media = await mediaOf(page.map((r) => r.id as string), true);
    // ONE preview link per post, for the tile only — the post's media are signed when it is opened
    posts = await Promise.all(
      page.map(async (r) => {
        const m = media.get(r.id as string);
        const first = m?.first ?? null;
        const key = (first?.thumb_key as string | null | undefined) || (first?.media_kind === "image" ? (first.object_key as string) : null);
        return {
          id: r.id as string,
          creatorId: r.creator_id as string,
          createdAt: r.created_at as string,
          caption: (r.caption as string | null) ?? null,
          items: m?.n ?? 0,
          hasVideo: m?.video ?? false,
          previewUrl: key && hasPrivateR2 ? await presignPrivateGet(key, SIGNED_TTL_SECONDS) : null,
          hidden: audienceOf(r.audience) === "hidden",
        };
      }),
    );
    const last = page[page.length - 1];
    next = rows.length > FEED_PAGE && last ? encodeSubCursor(last.created_at as string, last.id as string) : null;
  }

  const used = new Set(posts.map((p) => p.creatorId));
  const out: ExclusiveFeedPage = {
    posts,
    creators: Object.fromEntries([...creators].filter(([id]) => used.has(id))),
    next,
    subscriptions: allowed.length,
    ready: subs.ready,
  };
  if (!c) out.discover = await discover(viewerId, new Set(subs.ids));
  return { ok: true, ...out };
}

/**
 * Locked previews from creators the viewer follows and does not (yet) subscribe to: their
 * latest LOCKED post each, with the server's current price. Hidden posts are excluded in the
 * query. Nothing here starts or settles a purchase — the card's button goes to /api/sub/checkout.
 */
export async function discover(viewerId: string, subscribed: Set<string>): Promise<{ cards: DiscoverCard[]; creators: Record<string, DiscoverCreator> }> {
  const empty = { cards: [], creators: {} };
  const db = createAdminClient();
  const cfg = await subConfig();
  if (!cfg.purchasesEnabled) return empty;
  const [follows, blocks] = await Promise.all([
    db.from("follows").select("following_id").eq("follower_id", viewerId).limit(DISCOVER_FOLLOWS),
    db.from("blocks").select("blocker_id, blocked_id").or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`).limit(5000),
  ]);
  if (follows.error || blocks.error) return empty;
  const blocked = new Set(((blocks.data ?? []) as Row[]).map((b) => (b.blocker_id === viewerId ? b.blocked_id : b.blocker_id) as string));
  const candidates = ((follows.data ?? []) as Row[]).map((f) => f.following_id as string).filter((id) => id !== viewerId && !subscribed.has(id) && !blocked.has(id));
  if (!candidates.length) return empty;
  // only creators taking subscriptions right now, at a price inside the admin's bounds
  const { data: settings } = await db.from("creator_membership_settings").select("creator_id, sub_price_cents").in("creator_id", candidates).eq("sub_active", true).not("sub_price_cents", "is", null);
  const price = new Map<string, number>();
  for (const s of (settings ?? []) as Row[]) {
    const p = Number(s.sub_price_cents);
    if (Number.isInteger(p) && p >= cfg.minPriceCents && p <= cfg.maxPriceCents) price.set(s.creator_id as string, p);
  }
  const live = [...price.keys()];
  if (!live.length) return empty;
  const [people, postsR] = await Promise.all([
    creatorsById(live),
    // LOCKED only: a hidden post of a creator the viewer does not subscribe to never leaves the database
    db.from("sub_posts").select("id, creator_id, cover_url, created_at").in("creator_id", live).eq("status", "published").eq("audience", "locked").order("created_at", { ascending: false }).order("id", { ascending: false }).limit(DISCOVER_CARDS * 4),
  ]);
  // before 0248 (no audience column) discover stays empty rather than risk anything
  if (postsR.error) return empty;
  const seen = new Set<string>();
  const latest = ((postsR.data ?? []) as Row[]).filter((r) => {
    const id = r.creator_id as string;
    if (seen.has(id) || !people.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, DISCOVER_CARDS);
  const media = await mediaOf(latest.map((r) => r.id as string), false);
  const creators: Record<string, DiscoverCreator> = {};
  for (const r of latest) {
    const id = r.creator_id as string;
    const charge = subscriptionCharge(price.get(id)!, cfg.purchaseFeePercent);
    creators[id] = { ...people.get(id)!, priceCents: charge.priceCents, totalCents: charge.totalCents, periodDays: cfg.periodDays };
  }
  return {
    cards: latest.map((r) => ({ id: r.id as string, creatorId: r.creator_id as string, createdAt: r.created_at as string, coverUrl: (r.cover_url as string | null) ?? null, items: media.get(r.id as string)?.n ?? 0, hasVideo: media.get(r.id as string)?.video ?? false })),
    creators,
  };
}
