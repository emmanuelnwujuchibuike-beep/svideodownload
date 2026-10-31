import "server-only";

import { isAdult } from "@/lib/age/server";
import { subscriptionCharge } from "@/lib/creator/membership/engine";
import { flagsOf, isAccountVisibleTo } from "@/lib/social/account-visibility";
import { hasPrivateR2, presignPrivateGet } from "@/lib/storage/r2";
import { createAdminClient } from "@/lib/supabase/admin";

import { kickBlurClips } from "./blur-clip-kick";
import { postNeedsBlurWork } from "./blur-clip-plan";
import type { BlurLevel } from "./blur-level";
import { readBlurLevels, readBlurPreviews, readBlurSlides, readBlurVideos, type BlurSlide } from "./blur-preview";
import { cleanSeed, decodeShuffleCursor, encodeShuffleCursor, exclusiveOrder, newSeed } from "./feed-order";
import { audienceOf, decodeSubCursor, isUuid } from "./guards";
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
 *
 * ── Part 15 (2026-10-17) ────────────────────────────────────────────────────
 *  · Discover needs only who the viewer subscribes to and the block list, so it starts as soon
 *    as those are read and runs ALONGSIDE the feed's own reads — reusing that one block-list
 *    read instead of reading it again (same query, same filtering; a failed read still empties it).
 *  · A feed creator carries `accessUntil` — the membership's own period_end, from the same batched
 *    read (no extra query). Renewal is manual (Part 5), so access really does end then.
 *  · Preview links last five minutes. `feedPreviews` re-signs the tiles of posts the viewer may
 *    STILL see — access decided again, from scratch, exactly as for a feed page — so a tile
 *    reached after its link ran out can be refreshed. Every page says when its links were signed.
 *
 * ── Mature (18+), 0261 (owner 2026-10-18) ───────────────────────────────────
 * A Mature post's preview link, caption and public cover go only to a viewer whose age check says
 * adult. Anyone else gets the card marked `mature` and `ageLocked` with none of them — in the feed,
 * in a preview refresh and in discover. The age is read once per request, and only when a page
 * holds a Mature post. Before 0261 runs, no post is Mature.
 */

type Row = Record<string, unknown>;
const MISSING = (m: string) => /schema cache|does not exist|column/i.test(m);
export const FEED_PAGE = 12;
/** how many of the newest subscribed posts one visit's order is made from (lib/sub/feed-order.ts) — far beyond any scroll */
const FEED_CANDIDATES = 400;
/** at most this many subscribed creators feed one page (an `in (…)` list must fit in a request URL) */
export const FEED_MAX_CREATORS = 150;
/*
  🔴 EVERYBODY'S EXCLUSIVE POSTS (owner, 2026-10-22: "Exclusive feed doesn't show all posts from all users, it
  only shows the people you follow or subscribe to — it should show everybody's exclusive, and the posts of
  people you're not subscribed to should be blurred"). Discover used to offer ONE locked card per creator the
  viewer FOLLOWS, at most 8. It now draws the newest locked posts of EVERY creator taking subscriptions (not
  the viewer, not blocked either way, not already subscribed — their posts are the feed proper), several per
  creator, up to DISCOVER_CARDS. Still locked cards only: the public cover or the 20 px blur, never a file.
*/
const DISCOVER_CARDS = 40;
/** How many creators taking subscriptions discover draws from. */
const DISCOVER_PUBLIC_CREATORS = 200;
export const SIGNED_TTL_SECONDS = 300;
/**
 * Step 13 (ExclusiveFeed.dc.html, owner 2026-10-18: subscribed posts "play normally" in the feed): the
 * first item's own file is signed for a SUBSCRIBER's card so a video plays where it sits. Fifteen
 * minutes, so a clip someone is watching doesn't stop mid-scroll; it is still per viewer, never cached,
 * and minted only after the same access decision as everything else here.
 */
export const MEDIA_TTL_SECONDS = 900;
/** at most this many tiles are re-signed in one refresh */
export const PREVIEW_REFRESH_MAX = 24;

export interface FeedCreator {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string | null;
  verified: boolean;
  /** feed creators only: when the viewer's paid access ends (the membership's period_end) */
  accessUntil?: string | null;
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
  /** step 13: what the first item is, and a link to it for the in-feed player — only for a viewer with access */
  mediaKind?: "image" | "video";
  mediaUrl?: string | null;
  mediaWidth?: number | null;
  mediaHeight?: number | null;
  /** step 13: has this viewer liked it (the like row on the card) */
  viewerLiked?: boolean;
  /** 0261: Mature (18+) */
  mature?: true;
  /** 0261: Mature and this viewer hasn't confirmed they're 18+ — no preview or caption was sent */
  ageLocked?: true;
}

export interface DiscoverCard {
  id: string;
  creatorId: string;
  createdAt: string;
  /** the creator's PUBLIC teaser image (their choice); null = a plain locked tile */
  coverUrl: string | null;
  items: number;
  hasVideo: boolean;
  /** 0261: Mature (18+); the cover is withheld from a viewer who hasn't confirmed they're 18+ */
  mature?: true;
  /** 0263: the post's heavily blurred 20 px preview (a data URL) — never the file; withheld like the cover */
  blurUrl?: string;
  /** 0305: a locked video's 24 px blurred clip — autoplays behind a blur; withheld like the cover */
  blurVideoUrl?: string;
  /** 0306: one blurred slide per item (an album slides sideways); withheld like the cover */
  slides?: BlurSlide[];
  /** 0307: how blurry the creator wants it (lib/sub/blur-level.ts); absent = the default */
  blurLevel?: BlurLevel;
}

export interface DiscoverCreator extends FeedCreator {
  /** what a subscription costs now — the server's numbers, the same ones checkout charges */
  priceCents: number;
  /** the purchase fee on top, shown apart from the creator's price (Part 15) */
  feeCents: number;
  feePercent: number;
  totalCents: number;
  periodDays: number;
  /** step 13: how many posts a non-subscriber may know exist (locked, published) — "1 of N posts" */
  totalPosts?: number | null;
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
  /** when this page's preview links were signed (server ms), and how long they last (seconds) */
  issuedAt: number;
  previewTtl: number;
  /** the visit's shuffle (lib/sub/feed-order.ts): the client keeps it to resume the same order, and drops it to reshuffle */
  seed?: string;
}

type Fail = { ok: false; error: string; status: number };

interface Access {
  ids: string[];
  ready: boolean;
  /** creator → the latest period_end among the viewer's active memberships */
  until: Map<string, string>;
  /** both directions; null = the block list could not be read (discover then stays empty) */
  blocked: Set<string> | null;
}

/** The subscriptions and the block list, read ONCE per request and shared by the feed and discover. */
async function readAccess(viewerId: string): Promise<Access> {
  if (!isUuid(viewerId)) return { ids: [], ready: true, until: new Map(), blocked: new Set() };
  const db = createAdminClient();
  const [subs, blocks] = await Promise.all([
    db.from("creator_memberships").select("creator_id, period_end").eq("member_id", viewerId).eq("status", "active").eq("billing", "sub").gt("period_end", new Date().toISOString()).order("period_end", { ascending: false }).limit(FEED_MAX_CREATORS),
    db.from("blocks").select("blocker_id, blocked_id").or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`).limit(5000),
  ]);
  const blocked = blocks.error ? null : new Set(((blocks.data ?? []) as Row[]).map((b) => (b.blocker_id === viewerId ? b.blocked_id : b.blocker_id) as string));
  // a failed read is "no access": paid content fails CLOSED
  if (subs.error || !blocked) return { ids: [], ready: !subs.error || !MISSING(subs.error.message), until: new Map(), blocked };
  const until = new Map<string, string>();
  // newest period_end first, so the first row per creator is the one that counts
  for (const s of (subs.data ?? []) as Row[]) if (!until.has(s.creator_id as string)) until.set(s.creator_id as string, String(s.period_end));
  return { ids: [...until.keys()].filter((id) => id !== viewerId && !blocked.has(id)), ready: true, until, blocked };
}

/** Creators this viewer may see exclusive posts of right now: one batched read, the `hasActiveSub` predicate. */
export async function activeSubscriptions(viewerId: string): Promise<{ ids: string[]; ready: boolean }> {
  const { ids, ready } = await readAccess(viewerId);
  return { ids, ready };
}

/** A tile's preview: the approved small thumb, else the first PHOTO — never a video original. */
function previewKey(first: Row | null): string | null {
  return (first?.thumb_key as string | null | undefined) || (first?.media_kind === "image" ? (first.object_key as string) : null);
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
  const cols = withKeys ? "post_id, idx, media_kind, object_key, thumb_key, width, height" : "post_id, idx, media_kind";
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

/**
 * The feed page for a signed-in viewer. `cursor` is the previous page's `next`; a first page takes the visit's `seed` and
 * `since` (the viewer's last visit, ms). Ordered by lib/sub/feed-order.ts (owner, 2026-10-31): new since the last visit
 * first, then reshuffled per visit — it used to be newest-first, so it always opened on the same creator.
 */
export async function exclusiveFeed(viewerId: string, cursor?: string | null, visit: { seed?: string | null; since?: number | null } = {}): Promise<({ ok: true } & ExclusiveFeedPage) | Fail> {
  if (!isUuid(viewerId)) return { ok: false, error: "Sign in to see your exclusive feed.", status: 401 };
  const shuffle = decodeShuffleCursor(cursor);
  // an older client's date cursor is still checked, then answered as a fresh shuffle (its seen-list drops repeats)
  if (!shuffle && cursor && decodeSubCursor(cursor) === "invalid") return { ok: false, error: "Bad cursor.", status: 400 };
  const seed = shuffle?.seed ?? cleanSeed(visit.seed) ?? newSeed();
  const since = shuffle ? shuffle.sinceMs : typeof visit.since === "number" && Number.isFinite(visit.since) && visit.since > 0 ? visit.since : null;
  const offset = shuffle?.offset ?? 0;
  const c = offset > 0;
  const db = createAdminClient();
  const subs = await readAccess(viewerId);
  // first page: discover starts now, alongside the feed's reads (the no-op catch keeps an early return from leaving it unhandled)
  const discovering = c ? null : discover(viewerId, new Set(subs.ids), subs.blocked, { seed, since });
  discovering?.catch(() => {});
  const creators = await creatorsById(subs.ids);
  for (const [id, cr] of creators) cr.accessUntil = subs.until.get(id) ?? null;
  const allowed = [...creators.keys()];
  const issuedAt = Date.now();

  let posts: FeedPost[] = [];
  let next: string | null = null;
  if (allowed.length) {
    // newest schema first: Mature (0261) + audience (0248), then audience only, then neither
    const read = (level: number) => {
      const extra = ["mature, audience", "audience", ""][level]!;
      return db
        .from("sub_posts")
        .select(`id, creator_id, caption, created_at${extra ? `, ${extra}` : ""}`)
        .in("creator_id", allowed)
        .eq("status", "published")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        // the newest FEED_CANDIDATES, ordered here (new first, then the visit's shuffle) and paged by offset
        .limit(FEED_CANDIDATES);
    };
    let res = await read(0);
    if (res.error && MISSING(res.error.message)) res = await read(1);
    if (res.error && MISSING(res.error.message)) res = await read(2);
    if (res.error) return { ok: true, posts: [], creators: {}, next: null, subscriptions: allowed.length, ready: false, issuedAt, previewTtl: SIGNED_TTL_SECONDS };
    const rows = (res.data ?? []) as unknown as Row[];
    const ordered = exclusiveOrder(
      rows.map((r) => ({ id: r.id as string, creatorId: r.creator_id as string, createdAt: r.created_at as string, row: r })),
      seed,
      since,
    ).map((o) => o.row);
    const page = ordered.slice(offset, offset + FEED_PAGE);
    const adult = page.some((r) => r.mature === true) ? await isAdult(viewerId).catch(() => false) : true;
    const pageIds = page.map((r) => r.id as string);
    const [media, mine] = await Promise.all([
      mediaOf(pageIds, true),
      // which of these the viewer liked — at most a page of rows; counts are on the post's own viewer
      pageIds.length ? db.from("sub_post_likes").select("post_id").eq("user_id", viewerId).in("post_id", pageIds) : Promise.resolve({ data: [] as Row[], error: null }),
    ]);
    const liked = new Set(((mine.error ? [] : mine.data) ?? []).map((r) => (r as Row).post_id as string));
    // ONE preview link per post, for the tile only — the post's media are signed when it is opened
    posts = await Promise.all(
      page.map(async (r) => {
        const m = media.get(r.id as string);
        const mature = r.mature === true;
        const locked = mature && !adult;
        // a Mature post the viewer may not see yet: no link is even signed
        const key = locked ? null : previewKey(m?.first ?? null);
        const first = locked ? null : (m?.first ?? null);
        const kind = first?.media_kind === "video" ? "video" : first?.media_kind === "image" ? "image" : null;
        const [previewUrl, mediaUrl] = await Promise.all([
          key && hasPrivateR2 ? presignPrivateGet(key, SIGNED_TTL_SECONDS) : Promise.resolve(null),
          kind && hasPrivateR2 && typeof first?.object_key === "string" ? presignPrivateGet(first.object_key, MEDIA_TTL_SECONDS) : Promise.resolve(null),
        ]);
        return {
          id: r.id as string,
          creatorId: r.creator_id as string,
          createdAt: r.created_at as string,
          caption: locked ? null : ((r.caption as string | null) ?? null),
          items: m?.n ?? 0,
          hasVideo: m?.video ?? false,
          previewUrl,
          ...(kind ? { mediaKind: kind, mediaUrl, mediaWidth: (first?.width as number | null) ?? null, mediaHeight: (first?.height as number | null) ?? null } : {}),
          viewerLiked: liked.has(r.id as string),
          hidden: audienceOf(r.audience) === "hidden",
          ...(mature ? { mature: true as const } : {}),
          ...(locked ? { ageLocked: true as const } : {}),
        };
      }),
    );
    next = offset + FEED_PAGE < ordered.length ? encodeShuffleCursor(seed, offset + FEED_PAGE, since) : null;
  }

  const used = new Set(posts.map((p) => p.creatorId));
  const out: ExclusiveFeedPage = {
    posts,
    // step 13: the first page carries every creator the viewer subscribes to (the "Your subscriptions" row);
    // a later page only the ones its posts need
    creators: Object.fromEntries([...creators].filter(([id]) => !c || used.has(id))),
    next,
    subscriptions: allowed.length,
    ready: subs.ready,
    issuedAt,
    previewTtl: SIGNED_TTL_SECONDS,
    seed,
  };
  if (discovering) out.discover = await discovering;
  return { ok: true, ...out };
}

/**
 * The Exclusive feed for a SIGNED-OUT visitor (owner, 2026-10-22: "make anonymous users able to see
 * the exclusive feed, not the contents"). No subscriptions, so no posts and no signed links at all —
 * only the discover cards (public cover / 20 px blur, prices from the same numbers checkout uses).
 * Every action on the page asks them to sign in (features/sub/exclusive-feed.tsx `guest`).
 */
export async function publicExclusiveFeed(): Promise<ExclusiveFeedPage> {
  const issuedAt = Date.now();
  // a fresh shuffle on every visit, like a member's (lib/sub/feed-order.ts)
  const found = await discover(null, new Set(), undefined, { seed: newSeed() }).catch(() => ({ cards: [], creators: {} }));
  return { posts: [], creators: {}, next: null, subscriptions: 0, ready: true, issuedAt, previewTtl: SIGNED_TTL_SECONDS, discover: found };
}

/**
 * Fresh preview links for feed tiles whose links ran out (Part 15). The ids come from the
 * browser, so they prove nothing: access is decided again exactly as for a feed page (active
 * paid membership, blocks both ways, suspended/hidden accounts, published posts only). A post
 * the viewer may no longer see — or that is gone — is simply absent from the answer; a post
 * with no preview (a video with no thumb yet) answers null. At most PREVIEW_REFRESH_MAX ids.
 */
export async function feedPreviews(viewerId: string, ids: unknown): Promise<({ ok: true; previews: Record<string, string | null>; issuedAt: number; previewTtl: number }) | Fail> {
  if (!isUuid(viewerId)) return { ok: false, error: "Sign in to see your exclusive feed.", status: 401 };
  if (!Array.isArray(ids) || !ids.length || ids.length > PREVIEW_REFRESH_MAX || !ids.every((x) => typeof x === "string" && isUuid(x))) return { ok: false, error: "Bad request.", status: 400 };
  const issuedAt = Date.now();
  const previews: Record<string, string | null> = {};
  const answer = { ok: true as const, previews, issuedAt, previewTtl: SIGNED_TTL_SECONDS };
  const subs = await readAccess(viewerId);
  const allowed = [...(await creatorsById(subs.ids)).keys()];
  if (!allowed.length || !hasPrivateR2) return answer;
  const wanted = [...new Set(ids as string[])];
  const pick = (cols: string) => createAdminClient().from("sub_posts").select(cols).in("id", wanted).in("creator_id", allowed).eq("status", "published");
  let res = await pick("id, mature");
  if (res.error && MISSING(res.error.message)) res = await pick("id");
  if (res.error) return answer;
  // 0261: a Mature post is refreshed only for a viewer who confirmed they're 18+ — otherwise it is left out
  const all = (res.data ?? []) as unknown as Row[];
  const adult = all.some((r) => r.mature === true) ? await isAdult(viewerId).catch(() => false) : true;
  const rows = all.filter((r) => adult || r.mature !== true);
  const media = await mediaOf(rows.map((r) => r.id as string), true);
  await Promise.all(
    rows.map(async (r) => {
      const key = previewKey(media.get(r.id as string)?.first ?? null);
      previews[r.id as string] = key ? await presignPrivateGet(key, SIGNED_TTL_SECONDS) : null;
    }),
  );
  return answer;
}

/**
 * Locked previews from creators the viewer follows and does not (yet) subscribe to: their
 * latest LOCKED post each, with the server's current price. Hidden posts are excluded in the
 * query. Nothing here starts or settles a purchase — the card's button goes to /api/sub/checkout.
 */
/**
 * `viewerId: null` is a SIGNED-OUT visitor (2026-10-22, the landing's Exclusive button): they follow
 * nobody and block nobody, so the candidates are every creator taking subscriptions — the newest
 * locked posts across them win the cards. Nothing more is exposed than to a signed-in non-subscriber:
 * the creator's public cover and the 20 px blur, never a file; a Mature cover is withheld (a visitor
 * has confirmed no age).
 */
export async function discover(viewerId: string | null, subscribed: Set<string>, knownBlocked?: Set<string> | null, visit: { seed?: string | null; since?: number | null } = {}): Promise<{ cards: DiscoverCard[]; creators: Record<string, DiscoverCreator> }> {
  const empty = { cards: [], creators: {} };
  // the feed already read the block list (null = that read failed → nothing to discover, as before)
  if (knownBlocked === null) return empty;
  const db = createAdminClient();
  // the settings, the follows and (only when not handed over) the block list, together
  const [cfg, blocks] = await Promise.all([
    subConfig(),
    viewerId && !knownBlocked ? db.from("blocks").select("blocker_id, blocked_id").or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`).limit(5000) : null,
  ]);
  if (!cfg.purchasesEnabled) return empty;
  if (blocks?.error) return empty;
  const blocked = knownBlocked ?? new Set(((blocks?.data ?? []) as Row[]).map((b) => (b.blocker_id === viewerId ? b.blocked_id : b.blocker_id) as string));
  // every creator taking subscriptions right now, at a price inside the admin's bounds — not only the ones followed
  const { data: settings } = await db.from("creator_membership_settings").select("creator_id, sub_price_cents").eq("sub_active", true).not("sub_price_cents", "is", null).limit(DISCOVER_PUBLIC_CREATORS);
  const price = new Map<string, number>();
  for (const s of (settings ?? []) as Row[]) {
    const id = s.creator_id as string;
    // never the viewer's own posts, a creator blocked either way, or one already subscribed (their posts are the feed proper)
    if (id === viewerId || subscribed.has(id) || blocked.has(id)) continue;
    const p = Number(s.sub_price_cents);
    if (Number.isInteger(p) && p >= cfg.minPriceCents && p <= cfg.maxPriceCents) price.set(id, p);
  }
  const live = [...price.keys()];
  if (!live.length) return empty;
  const [people, postsR] = await Promise.all([
    creatorsById(live),
    // LOCKED only: a hidden post of a creator the viewer does not subscribe to never leaves the database
    (async () => {
      const q = (cols: string) => db.from("sub_posts").select(cols).in("creator_id", live).eq("status", "published").eq("audience", "locked").order("created_at", { ascending: false }).order("id", { ascending: false }).limit(DISCOVER_CARDS * 4);
      const r = await q("id, creator_id, cover_url, created_at, mature");
      // before 0261 there is no Mature column — the same read without it (the audience filter stays)
      return r.error && MISSING(r.error.message) && /mature/.test(r.error.message) ? q("id, creator_id, cover_url, created_at") : r;
    })(),
  ]);
  // before 0248 (no audience column) discover stays empty rather than risk anything
  if (postsR.error) return empty;
  // the newest locked posts across them — several per creator now, not one — of visible accounts only
  // the same order as the feed (lib/sub/feed-order.ts, owner 2026-10-31): new since the last visit first, then this visit's
  // shuffle — newest-first opened on the same creator every time
  const latest = exclusiveOrder(
    ((postsR.data ?? []) as unknown as Row[]).filter((r) => people.has(r.creator_id as string)).map((r) => ({ id: r.id as string, creatorId: r.creator_id as string, createdAt: r.created_at as string, row: r })),
    cleanSeed(visit.seed) ?? newSeed(),
    typeof visit.since === "number" && visit.since > 0 ? visit.since : null,
  )
    .map((o) => o.row)
    .slice(0, DISCOVER_CARDS);
  const [media, adult, blurs, blurVideos, slides, levels] = await Promise.all([
    mediaOf(latest.map((r) => r.id as string), false),
    latest.some((r) => r.mature === true) ? (viewerId ? isAdult(viewerId).catch(() => false) : Promise.resolve(false)) : Promise.resolve(true),
    readBlurPreviews(latest.map((r) => r.id as string)).catch(() => new Map<string, string>()),
    readBlurVideos(latest.map((r) => r.id as string)).catch(() => new Map<string, string>()),
    readBlurSlides(latest.map((r) => r.id as string)).catch(() => new Map<string, BlurSlide[]>()),
    readBlurLevels(latest.map((r) => r.id as string)).catch(() => new Map<string, BlurLevel>()),
  ]);
  const totals = new Map<string, number | null>(
    await Promise.all(
      [...new Set(latest.map((r) => r.creator_id as string))].map(async (id) => {
        const c = await db.from("sub_posts").select("id", { count: "exact", head: true }).eq("creator_id", id).eq("status", "published").eq("audience", "locked");
        return [id, c.error ? null : (c.count ?? null)] as const;
      }),
    ),
  );
  const creators: Record<string, DiscoverCreator> = {};
  for (const r of latest) {
    const id = r.creator_id as string;
    const charge = subscriptionCharge(price.get(id)!, cfg.purchaseFeePercent);
    creators[id] = { ...people.get(id)!, priceCents: charge.priceCents, feeCents: charge.feeCents, feePercent: cfg.purchaseFeePercent, totalCents: charge.totalCents, periodDays: cfg.periodDays, totalPosts: totals.get(id) ?? null };
  }
  /*
    A locked video with no blurred clip yet: the worker makes every missing one (owner, 2026-10-29 — every exclusive
    post autoplays blurred). Throttled, after the response; this read never waits on it.
  */
  if (latest.some((r) => postNeedsBlurWork(slides.get(r.id as string), media.get(r.id as string)?.video ?? false, blurVideos.get(r.id as string)))) kickBlurClips();
  return {
    /*
      0261: a Mature post's public COVER (a full-size picture) only for a viewer who confirmed they're 18+. Its blurred
      previews go to EVERY non-subscriber (owner, 2026-10-29: "the 18+ and all exclusive should auto play … blurred on
      unsubscriber, nothing less than that, no optionals"): a 20 px still and a 24 px clip hold no detail to recover —
      the post itself, and its cover, stay behind the subscription and the age check.
    */
    cards: latest.map((r) => ({ id: r.id as string, creatorId: r.creator_id as string, createdAt: r.created_at as string, coverUrl: r.mature === true && !adult ? null : ((r.cover_url as string | null) ?? null), items: media.get(r.id as string)?.n ?? 0, hasVideo: media.get(r.id as string)?.video ?? false, ...(r.mature === true ? { mature: true as const } : {}), ...(blurs.has(r.id as string) ? { blurUrl: blurs.get(r.id as string)! } : {}), ...(blurVideos.has(r.id as string) ? { blurVideoUrl: blurVideos.get(r.id as string)! } : {}), ...(slides.has(r.id as string) ? { slides: slides.get(r.id as string)! } : {}), ...(levels.has(r.id as string) ? { blurLevel: levels.get(r.id as string)! } : {}) })),
    creators,
  };
}
