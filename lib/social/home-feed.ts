import { cacheDelete, getCached } from "@/lib/cache";
import { FEED_AD_INTERVAL } from "@/lib/feed/ad-slots";
import type { BillingPlan } from "@/lib/monetization/types";
import { createAdminClient } from "@/lib/supabase/admin";

import { flagsOf, isAccountVisibleTo, relationTo } from "./account-visibility";
import type { Category } from "./categories";
import { fetchReactionRows } from "./engagement";
import { friendIdSet } from "./friend-ids";
import { getTrendingSettings } from "./feed";
import { getHomePreferences, type HomePreferences } from "./home-preferences";
import { canSeePost, type MediaKind, type Visibility } from "./posts";
import { pulseActivityForPosts, type PulseActivity } from "./pulse-activity";
import { commentPreviewsForPosts, creatorsWithActiveStories, type CommentPreview } from "./reel-extras";
import { relationshipStrength } from "./graph/strength";
import type { RepostAudience } from "./repost/audience";
import { rankReposts, type RepostCandidate } from "./repost/ranking";
import { repostReason } from "./repost/reason";
import { filterVisibleReposts, repostViewer } from "./repost/visibility";
import { followedReposters, repostCounts, viewerReposts } from "./reposts";

/**
 * Rich, privacy-filtered home feed. Unlike the lean Explore `getFeed`, each item
 * carries the publisher card, engagement counts, and the viewer's like/save/
 * follow state so the dashboard feed can render fully without N extra requests.
 * Privacy always wins (suspended / opted-out / blocked publishers are removed)
 * and a per-publisher diversity cap keeps one creator from flooding the feed —
 * capping happens AFTER ranking, so it keeps a creator's best posts, not just
 * their newest. "for_you" is genuinely ranked (see `rankForYou` below —
 * relationship + quality + freshness, no ML); "following"/"recent" stay a
 * plain, unranked reverse-chronological view of exactly what was posted.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface FeedPublisher {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  isVerified: boolean;
  plan: BillingPlan;
}

export interface FeedItem {
  id: string;
  title: string;
  description: string | null;
  platform: string;
  mediaKind: MediaKind;
  thumbnailUrl: string | null;
  sourceUrl: string;
  mediaUrl: string | null;
  /** Cloudflare Stream UID for adaptive-bitrate playback (null → play `mediaUrl`). */
  streamUid: string | null;
  /** Has Cloudflare confirmed this Stream video finished transcoding? Informational (best-effort, default false pre-migration/webhook) — never gates playback, since "false" also means "haven't heard back yet". */
  streamReady?: boolean;
  /** Cloudflare confirmed this Stream video's transcode FAILED — skip HLS entirely and go straight to the MP4 fallback rather than wasting a fetch on a manifest that will never exist. */
  streamFailed?: boolean;
  category: string | null;
  durationSec: number | null;
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  savesCount: number;
  downloadsCount: number;
  createdAt: string;
  /** Momentum Engine™ (Feature 15 Part 8) — 0 pre-migration/pre-recompute. */
  momentumScore?: number;
  publisher: FeedPublisher;
  viewerLiked: boolean;
  viewerSaved: boolean;
  /** The Wow flavor the viewer picked (reaction picker) — null/undefined = plain Wow. */
  viewerReactionEmotion?: string | null;
  isFollowing: boolean;
  isOwner: boolean;
  /** True when the post carries a poll (vote) — the card fetches + renders it. */
  hasPoll: boolean;
  /** Repost state — optional/best-effort (0/false before the reposts migration). */
  viewerReposted?: boolean;
  repostsCount?: number;
  /** Followed users who reposted this — the premium repost badge (avatars + "+N"),
      plus the newest reposter's recommendation caption when they wrote one. */
  repostBadge?: { avatars: (string | null)[]; handles: string[]; count: number; caption?: string | null };
  /**
   * Why this repost is in the feed (Feature 15 Part 4).
   *
   * 🔴 Produced by the SAME branch that ranked it — `reason.ts` reads the
   * signals `scoreRepost` emitted. A component must never re-derive this from
   * the props it happens to have: a guessed explanation is plausible,
   * unfalsifiable and sometimes false, which is worse than none.
   *
   * Only present on a SURFACED repost — a post that is in the feed on its own
   * merits did not need a reason, and attaching one would imply it was
   * recommended when it was not.
   */
  repostReason?: { kind: string; text: string; emoji: string; detail: string[] };
  /**
   * The repost this item was surfaced through, so an interaction with it can be
   * attributed back (Feature 15 Part 4). Absent on organic items.
   */
  viaRepostId?: string;
  /**
   * People the viewer FOLLOWS who liked, reposted or commented on this post —
   * the real data behind Social Pulse™ and Friend Energy™ (Feature 15 Part 3).
   *
   * 🔴 Absent when there is none, and there usually is none. Nothing downstream
   * may substitute a placeholder: an invented "people are watching this" is the
   * fabricated social proof this project has declined three times.
   */
  friendActivity?: PulseActivity;
  /**
   * The one comment worth showing beside the Comment button, and WHY it was
   * chosen (Feature 15 Part 3, tranche 2). Absent when the post has no usable
   * comment. See lib/social/reel-extras.ts — the newest comment is the FLOOR
   * of that ordering, not its default.
   */
  commentPreview?: CommentPreview;
  /** The creator has a story that is still live — draws the rail avatar's ring. */
  publisherHasStory?: boolean;
  /** Natural pixel size of an image post — lets the feed render it with next/image. */
  mediaWidth?: number | null;
  mediaHeight?: number | null;
  /** Album/carousel items (ordered; present only on multi-media posts). */
  mediaItems?: { url: string; kind: "image" | "video"; thumbnailUrl: string | null; width: number | null; height: number | null }[];
  /**
   * The attached sound (Feature 15 Part 7), when this post carries one.
   * Absent on the vast majority of posts — attaching a sound is opt-in, and
   * the reel-viewer's sound row falls back to its own-audio label ("Original
   * sound · @handle") exactly as before when this is undefined.
   */
  sound?: { id: string; title: string; artistLabel: string } | null;
}

export interface FeedPage {
  items: FeedItem[];
  /**
   * 🔴 A POST OFFSET, AND ONLY EVER A POST OFFSET.
   *
   * Advertising slots are composed on top of this list at render time and are
   * never rows in it (2026-08-24). Nothing may add to this because an ad was
   * shown — doing so advances the cursor past real posts, which surfaces as
   * "posts are missing from my feed" and is essentially untraceable back to
   * advertising. See `countPosts` in lib/feed/ad-slots.ts.
   */
  nextOffset: number | null;
  /**
   * Insert an ad slot after every N posts; 0 means none.
   *
   * The SERVER decides this — the brief's core requirement is that the ad
   * network must not be what determines where an ad appears. It travels in the
   * payload rather than being read from the constant on the client so that the
   * cadence can later become an operator setting (or vary by surface, plan or
   * experiment) with no client change at all: one server value feeds every
   * render path.
   */
  adInterval: number;
}

/**
 * The "nothing to show" page.
 *
 * Still carries `adInterval` so the shape is uniform — a caller must never have
 * to check whether the field is present, and an empty feed with no posts simply
 * composes no slots (ads are only ever placed BETWEEN posts).
 */
function emptyFeedPage(): FeedPage {
  return { items: [], nextOffset: null, adInterval: FEED_AD_INTERVAL };
}

export interface Row {
  id: string;
  publisher_id: string;
  source_url: string;
  platform: string;
  media_kind: MediaKind;
  title: string;
  description: string | null;
  category: string | null;
  thumbnail_url: string | null;
  media_url: string | null;
  duration_sec: number | null;
  visibility: string;
  status: string;
  stream_uid?: string | null;
  views_count: number;
  likes_count: number;
  saves_count: number;
  shares_count: number;
  comments_count: number;
  downloads_count: number;
  created_at: string;
  is_nsfw?: boolean;
  /** Feature 15 Part 8 — absent pre-migration 0133 (see `hasMomentumColumn`). */
  momentum_score?: number;
}

const SELECT =
  "id, publisher_id, source_url, platform, media_kind, title, description, category, thumbnail_url, media_url, stream_uid, duration_sec, visibility, status, views_count, likes_count, saves_count, shares_count, comments_count, downloads_count, created_at, is_nsfw";

// `posts.momentum_score` arrives with migration 0133 — same straddle pattern
// as `hasFormatColumn` above, so the whole feed doesn't 500 on an
// unmigrated instance (this exact failure class — a query erroring on a
// missing column and the outer try/catch swallowing it into an empty page —
// is documented in the project's own migration-gotcha notes).
let momentumColumnKnown: boolean | null = null;
async function hasMomentumColumn(db: ReturnType<typeof createAdminClient>): Promise<boolean> {
  if (momentumColumnKnown !== null) return momentumColumnKnown;
  const { error } = await db.from("posts").select("momentum_score").limit(1);
  momentumColumnKnown = !error;
  return momentumColumnKnown;
}

export type HomeFeedSort = "for_you" | "following" | "recent" | "trending";

/** Feed vs Reels are separate products: each surface queries only its format. */
export type ContentFormat = "feed" | "reel";

// `posts.format` arrives with migration 0031 — probe once per server instance
// so both surfaces keep their pre-migration behavior (shared pool) until it's
// applied, then split automatically.
let formatColumnKnown: boolean | null = null;
async function hasFormatColumn(db: ReturnType<typeof createAdminClient>): Promise<boolean> {
  if (formatColumnKnown !== null) return formatColumnKnown;
  const { error } = await db.from("posts").select("format").limit(1);
  formatColumnKnown = !error;
  return formatColumnKnown;
}

/**
 * "For You" ranking — a transparent, explainable weighted score over signals
 * already stored on the row. No ML, no external calls, nothing hidden: a
 * relationship layer (do you follow this creator?), a quality layer
 * (conversation + shares weighted above passive likes — the same weights
 * `lib/social/smart-feed.ts`'s `engagementScore`/`feedReason` already use
 * client-side, kept in sync so the "why am I seeing this" chip stays
 * truthful), and a freshness layer that decays smoothly rather than a hard
 * cliff, so a great post from yesterday can still outrank a mediocre one
 * from an hour ago. Only applied to "for_you" — "following" and "recent"
 * stay a plain, unranked reverse-chronological view of exactly what was
 * posted, which is the behavior a dedicated Following/Reels feed should have.
 *
 * Before this, "for_you" and "recent" produced the IDENTICAL ordering (both
 * were just `ORDER BY created_at DESC`) — "For You" wasn't actually FOR
 * anyone; it was just "newest first" wearing a different label.
 *
 * `prefs` (Feature 17 Part 13) layers the viewer's own explicit choices on
 * top, transparently — never hidden ML, just the same weighted-score model
 * with a couple more real inputs: `preferFriends` raises the relationship
 * bonus ("prioritize my friends"); `boostedCategories` adds a flat bonus to
 * matching posts ("more technology"). Muted categories are NOT scored down
 * here — they're excluded entirely one level up in `loadHomeFeed`, mirroring
 * `muted_creators`' absolute semantics ("mute" removes, it doesn't just
 * de-rank).
 */
export function rankForYou(
  rows: Row[],
  followingIds: Set<string>,
  prefs?: Pick<HomePreferences, "preferFriends" | "boostedCategories">,
  seed?: string,
  /**
   * Pin posts from the last {@link NEW_POST_WINDOW_MS} to the top, newest
   * first, bypassing both scoring and the shuffle.
   *
   * OFF by default, and that default is the 2026-08-26 change: this used to be
   * unconditional, so every entry and every refresh re-pinned the same newest
   * post and the feed read as frozen. It is now opted into by exactly one
   * caller — the "N new posts" pill — because that is the only moment the
   * viewer has been PROMISED specific posts and would rightly call it broken
   * not to see them. Entry, pull-to-refresh and pagination all reshuffle.
   */
  pinNew = false,
): Row[] {
  const now = Date.now();
  /* Scaled to match the compressed quality/freshness below. At the old
     120/220 — set when `quality` was raw and unbounded — a followed creator
     would own the entire feed once quality became log-scaled. */
  const relationshipBonus = prefs?.preferFriends ? 46 : 25;
  const boosted = new Set(prefs?.boostedCategories ?? []);
  const scored = rows.map((row, i) => {
    const ageHours = Math.max(0, (now - new Date(row.created_at).getTime()) / 3_600_000);
    const relationship = followingIds.has(row.publisher_id) ? relationshipBonus : 0;
    /*
      🔴 BOTH INPUTS ARE COMPRESSED, AND THAT IS WHAT MAKES THE SHUFFLE REAL.

      Dropping the day-bucket tier below was necessary but NOT sufficient — the
      first attempt at this (reverted 2026-08-26) removed the tier and the feed
      still came back newest-first, because the SCALES alone prevented any
      cross-age mixing:

        • `quality` was raw and unbounded. A post with 900 likes scored ~900
          against a fresh post's ~40, so no jitter could ever reorder them.
          `log1p` preserves the ordering — more engagement still ranks higher —
          while collapsing the range: 900 likes becomes ~55, not 900.
        • `freshness` decayed over ~30 hours, so yesterday's post scored half
          of today's and the day before a third. Stretching the constant to 240
          hours keeps recency a real bias — a new post still outscores a
          ten-day-old one — but by a margin the jitter can actually cross.

      Net: recency and engagement still decide the AVERAGE position, while the
      per-refresh jitter genuinely reorders ACROSS days, which is what "random
      videos from older to newer" requires.
    */
    const engagement =
      row.likes_count + row.comments_count * 2 + row.shares_count * 3 + row.saves_count * 2 + row.downloads_count * 2;
    const quality = Math.log1p(Math.max(0, engagement)) * 8;
    const freshness = 80 / (1 + ageHours / 240);
    const interest = row.category && boosted.has(row.category as Category) ? 14 : 0;
    // Momentum Engine™ (Feature 15 Part 8) — a modest bonus, not a new tier.
    // `momentum_score` already favors young + rising posts on its own scale
    // (see recompute_momentum_scores); this is deliberately small relative to
    // `quality`/`relationship` so a rising post gets a nudge up the order
    // rather than overriding the ranking model wholesale.
    const momentum = (row.momentum_score ?? 0) * 1.5;
    const createdMs = new Date(row.created_at).getTime();
    const isBrandNew = now - createdMs < NEW_POST_WINDOW_MS;
    const base = relationship + quality + freshness + interest + momentum;
    // Per-refresh reshuffle (owner: "every refresh should reshuffle the feed
    // post arrangement like tiktok"). MULTIPLICATIVE, not additive: it varies a
    // post's score by ±SHUFFLE_SPREAD/2 of its OWN value, so posts of similar
    // standing trade places on each refresh while a genuinely strong post never
    // gets buried and a weak one never rockets to the top — the feed feels
    // alive without the ranking becoming a lottery. Since 2026-08-26 this
    // spans the WHOLE catalogue rather than being confined within one day.
    const score = seed ? base * (1 + (seededUnit(seed, row.id) - 0.5) * SHUFFLE_SPREAD) : base;
    return { row, score, i, createdMs, isBrandNew };
  });
  scored.sort((a, b) => {
    /*
      ═══════════════════════════════════════════════════════════════════════
       ONE TIER. THE SHUFFLE SPANS THE WHOLE CATALOGUE.
      ═══════════════════════════════════════════════════════════════════════

      Owner, 2026-08-26: "feed should show random videos from older to newer
      every time a user first enters the feed … it shouldnt show a fixed new
      post … after a refresh it should show a reshuffled post from oldest to
      new, from the first post to the new post every refresh and first entry".

      🔴 THIS SUPERSEDES TWO EARLIER INSTRUCTIONS OF THE OWNER'S. Both are named
      here so nobody "restores" them as bug fixes:

        • 2026-08-17 — "ranked by date first before most liked … shows the
          newest on every cold entry" → the DAY BUCKET tier, under which a post
          from an earlier day could not outrank a newer one at ANY score.
        • the unconditional 30-minute BRAND-NEW PIN — "new post should be at the
          top when the new post button is clicked and when is refresh".

      Together those produced exactly the behaviour later reported as the bug:
      the same newest post at the top of every entry, with the shuffle able to
      reorder only WITHIN a single day — invisible on this catalogue's volume.

      What replaces them is a single jittered score over every candidate.
      Recency is still an input (`freshness`, plus `momentum`, which favours
      young rising posts), so a new post still TENDS to surface high — it is
      simply no longer GUARANTEED the top slot, which is precisely what
      "shouldn't show a fixed new post" asks for.
    */
    // The one surviving pin, and it is now opt-in: see `pinNew`. Only the
    // "N new posts" pill sets it, because that pill makes a specific promise
    // about specific posts. Nothing else does, so nothing else pins.
    if (pinNew) {
      if (a.isBrandNew !== b.isBrandNew) return a.isBrandNew ? -1 : 1;
      // Among the pinned: strict recency, newest first. `a.i - b.i` is the
      // tiebreak for identical timestamps (rows arrive newest-first).
      if (a.isBrandNew) return b.createdMs - a.createdMs || a.i - b.i;
    }
    // Jittered score, tiebreak on original (recency) order so equal scores are
    // stable across otherwise-identical requests rather than flapping.
    return b.score - a.score || a.i - b.i;
  });
  return scored.map((s) => s.row);
}

/**
 * How long a post counts as "brand new" for the OPT-IN pin (`pinNew`).
 *
 * Until 2026-08-26 this window applied on every request, which is what made
 * the feed look frozen: on this catalogue's posting volume the newest post is
 * usually still inside it, so it re-pinned to the top of every entry and every
 * refresh and the shuffle only ever reached the tail. The window itself was
 * never the problem — applying it unconditionally was. It now scopes exactly
 * one caller: the "N new posts" pill, where 30 minutes comfortably covers the
 * gap between a post arriving over realtime and the viewer tapping the pill.
 */
const NEW_POST_WINDOW_MS = 30 * 60 * 1000;

/**
 * ±45% of each post's own score.
 *
 * Raised from 0.5 (±25%) on 2026-08-26 together with the log-compressed
 * `quality` and the stretched `freshness`: those three numbers are ONE
 * setting and tuning any of them alone re-breaks the feed. At ±45% over the
 * compressed scale a ten-day-old post can genuinely reach the top on some
 * refreshes — "from oldest to new" — while a post with real engagement still
 * averages a far higher position than a dead one of the same age.
 */
const SHUFFLE_SPREAD = 0.9;

/**
 * Deterministic (seed, id) → [0,1). FNV-1a; no dependency, no `Math.random`.
 *
 * Determinism is the whole point, not an implementation detail: the feed is
 * OFFSET-paginated, so page 2 re-ranks the same candidate set page 1 did. A
 * fresh random per call would give each page a different order, which
 * duplicates some posts across pages and drops others entirely. Keying the
 * jitter off a seed that's constant for one refresh (and off the post's stable
 * id) means every page of that refresh agrees on one order, while the next
 * refresh — a new seed — produces a different one.
 */
function seededUnit(seed: string, id: string): number {
  const s = `${seed}:${id}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // 🔴 FINAL AVALANCHE (murmur3 fmix32) — NOT decoration, and NOT removable.
  //
  // Plain FNV-1a's last step is `h = imul(h ^ lastChar, 16777619)`, so the
  // trailing bytes never diffuse into the high bits that `(h >>> 0) / 2**32`
  // actually reads. Measured 2026-08-26: for ten ids sharing a prefix and
  // differing only in the FINAL character, raw FNV-1a produced values spanning
  // a band 0.04 wide (not ~1.0) and only 18 DISTINCT ORDERS across 200 seeds —
  // the same arrangement over and over. With fmix32: 200/200 distinct orders,
  // spread 0.86, deciles flat to within 0.15%.
  //
  // Live `posts.id` is `uuid_generate_v4()` (migration 0007), which varies
  // across its whole length, so the feed shuffle was never dead in production.
  // It is fixed anyway because the degenerate case is one id-scheme change
  // away (uuidv7 shares a long prefix), because reels shuffles by this value
  // ALONE, and because the test fixtures use ids like `q0`…`q9` — so the
  // suite could not tell a working shuffle from a broken one.
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * A single feed item by post id, in the exact `FeedItem` shape the reel deck
 * (and, more generally, any instant client-side viewer) expects — used to
 * deep-link straight into `/reels?start=<id>` (video, unchanged) AND to open
 * a post tapped from a grid (Explore/Profile/Search/Saved — `components/
 * social/post-grid.tsx`) without a full-page `/p/[id]` navigation, of any
 * media kind. Visibility uses the same `canSeePost` rule as the real post
 * page (owner/follower/public), not a public-only gate — a private post the
 * viewer is genuinely allowed to see (their own, or a followed friend's
 * followers-only post) must still open instantly from their own grid.
 */
export async function getFeedItemById(id: string, viewerId: string | null): Promise<FeedItem | null> {
  if (!hasSupabase) return null;
  try {
    const db = createAdminClient();
    const { data } = await db.from("posts").select(SELECT).eq("id", id).maybeSingle();
    const row = data as Row | null;
    if (!row || !(await canSeePost(db, { ...row, visibility: row.visibility as Visibility }, viewerId))) return null;

    const { data: prof } = await db
      .from("profiles")
      .select("id, handle, display_name, avatar_url, is_verified, is_suspended, is_hidden")
      .eq("id", row.publisher_id)
      .maybeSingle();
    if (!prof || !prof.handle) return null;
    // An admin-hidden author's post still opens for their friends (0082); it 404s
    // for everyone else, exactly as a suspended author's does for all.
    if (!isAccountVisibleTo(flagsOf(prof), relationTo(row.publisher_id, viewerId, await friendIdSet(viewerId))))
      return null;

    const { data: subs } = await db
      .from("subscriptions")
      .select("plan")
      .eq("user_id", row.publisher_id)
      .in("status", ["active", "trialing"])
      .maybeSingle();

    let viewerLiked = false;
    let viewerSaved = false;
    let viewerEmotion: string | null = null;
    let isFollowing = false;
    if (viewerId) {
      const [{ count: blockedCount }, reactions, { count: followCount }] = await Promise.all([
        db
          .from("blocks")
          .select("blocker_id", { head: true, count: "exact" })
          .or(`and(blocker_id.eq.${row.publisher_id},blocked_id.eq.${viewerId}),and(blocker_id.eq.${viewerId},blocked_id.eq.${row.publisher_id})`),
        fetchReactionRows(db, viewerId, [id]),
        db.from("follows").select("follower_id", { head: true, count: "exact" }).eq("follower_id", viewerId).eq("following_id", row.publisher_id),
      ]);
      if ((blockedCount ?? 0) > 0) return null;
      for (const r of reactions) {
        if (r.type === "like") {
          viewerLiked = true;
          viewerEmotion = r.emotion;
        } else if (r.type === "save") viewerSaved = true;
      }
      isFollowing = (followCount ?? 0) > 0;
    }

    const streamStat = row.stream_uid ? (await streamStatus(db, [row.id])).get(row.id) : undefined;

    let hasPoll = false;
    try {
      const { count: pollCount } = await db.from("post_polls").select("post_id", { head: true, count: "exact" }).eq("post_id", id);
      hasPoll = (pollCount ?? 0) > 0;
    } catch {
      /* polls not migrated — leave hasPoll false */
    }

    // Album items (carousels/reel albums) — same query as getHomeFeed's batch
    // fetch, just scoped to this one id, so a grid-tile open renders every
    // slide instead of only the cover.
    let mediaItems: FeedItem["mediaItems"];
    try {
      const { data: mediaRows } = await db
        .from("post_media")
        .select("media_kind, media_url, thumbnail_url, media_width, media_height")
        .eq("post_id", id)
        .order("idx", { ascending: true });
      const arr = ((mediaRows ?? []) as { media_kind: "image" | "video"; media_url: string; thumbnail_url: string | null; media_width: number | null; media_height: number | null }[]).map(
        (r) => ({ url: r.media_url, kind: r.media_kind, thumbnailUrl: r.thumbnail_url, width: r.media_width, height: r.media_height }),
      );
      if (arr.length > 1) mediaItems = arr;
    } catch {
      /* post_media not migrated */
    }

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      platform: row.platform,
      mediaKind: row.media_kind,
      thumbnailUrl: row.thumbnail_url,
      sourceUrl: row.source_url,
      mediaUrl: row.media_url,
      streamUid: row.stream_uid ?? null,
      streamReady: streamStat?.ready ?? false,
      streamFailed: streamStat?.failed ?? false,
      category: row.category,
      durationSec: row.duration_sec,
      viewsCount: row.views_count,
      likesCount: row.likes_count,
      commentsCount: row.comments_count,
      sharesCount: row.shares_count,
      savesCount: row.saves_count,
      downloadsCount: row.downloads_count,
      createdAt: row.created_at,
      publisher: {
        id: prof.id as string,
        handle: prof.handle as string,
        displayName: (prof.display_name as string) || `@${prof.handle as string}`,
        avatarUrl: (prof.avatar_url as string) ?? null,
        isVerified: (prof.is_verified as boolean) ?? false,
        plan: (subs?.plan as BillingPlan) ?? "free",
      },
      viewerLiked,
      viewerSaved,
      viewerReactionEmotion: viewerEmotion,
      isFollowing,
      isOwner: viewerId === row.publisher_id,
      hasPoll,
      viewerReposted: (await viewerReposts([id], viewerId)).has(id),
      repostsCount: (await repostCounts([id])).get(id) ?? 0,
      mediaItems,
    };
  } catch {
    return null;
  }
}

/**
 * Natural pixel sizes for a post's media (best-effort — empty before 0028).
 *
 * 🔴 This used to be called only for IMAGES, and that omission is what made the
 * home feed "stretch too much length" (owner, 2026-08-11). A video card cannot
 * know its own shape until the browser has parsed the file's metadata, which
 * happens late — the source is attached only as the card nears the viewport —
 * so until then `FeedVideo` reserved a 3:4 box. A 16:9 clip in a 3:4 box is
 * `object-contain`ed with a thick black bar above AND below it, and the card is
 * a third taller than the video it contains. Every landscape download in the
 * feed looked like that.
 *
 * The column has always held the answer for videos too; nothing asked for it.
 */
async function mediaDimensions(
  db: ReturnType<typeof createAdminClient>,
  ids: string[],
): Promise<Map<string, { w: number; h: number }>> {
  const out = new Map<string, { w: number; h: number }>();
  if (ids.length === 0) return out;
  try {
    const { data } = await db.from("posts").select("id, media_width, media_height").in("id", ids);
    for (const r of (data ?? []) as { id: string; media_width: number | null; media_height: number | null }[]) {
      if (r.media_width && r.media_height) out.set(r.id, { w: r.media_width, h: r.media_height });
    }
  } catch {
    /* columns not migrated yet */
  }
  return out;
}

/**
 * Cloudflare Stream processing status for video posts, driven by the Stream
 * webhook (best-effort — empty/false-y for all before migration 0029 or until
 * the webhook fires). `ready` is informational only; `failed` is the one signal
 * safe to act on (skip HLS for a video that will never transcode).
 */
async function streamStatus(
  db: ReturnType<typeof createAdminClient>,
  ids: string[],
): Promise<Map<string, { ready: boolean; failed: boolean }>> {
  const out = new Map<string, { ready: boolean; failed: boolean }>();
  if (ids.length === 0) return out;
  try {
    const { data } = await db.from("posts").select("id, stream_ready, stream_error").in("id", ids);
    for (const r of (data ?? []) as { id: string; stream_ready: boolean | null; stream_error: string | null }[]) {
      out.set(r.id, { ready: !!r.stream_ready, failed: !!r.stream_error });
    }
  } catch {
    /* columns not migrated yet */
  }
  return out;
}

/**
 * The attached sound's title/artist for each post that carries one (Feature
 * 15 Part 7). Same two-step shape as the other batch lookups here: most posts
 * have no `sound_id` at all, so this skips both queries entirely for a feed
 * page with none — best-effort, before migration 0125 `posts.sound_id` simply
 * doesn't exist and this returns empty rather than failing the whole feed.
 */
async function soundInfo(
  db: ReturnType<typeof createAdminClient>,
  ids: string[],
): Promise<Map<string, { id: string; title: string; artistLabel: string }>> {
  const out = new Map<string, { id: string; title: string; artistLabel: string }>();
  if (ids.length === 0) return out;
  try {
    const { data: posts } = await db.from("posts").select("id, sound_id").in("id", ids).not("sound_id", "is", null);
    const soundIds = [...new Set((posts ?? []).map((p) => (p as { sound_id: string }).sound_id))];
    if (soundIds.length === 0) return out;
    const { data: sounds } = await db.from("sounds").select("id, title, artist_label").in("id", soundIds);
    const byId = new Map((sounds ?? []).map((s) => [(s as { id: string }).id, s as { id: string; title: string; artist_label: string }]));
    for (const p of (posts ?? []) as { id: string; sound_id: string }[]) {
      const s = byId.get(p.sound_id);
      if (s) out.set(p.id, { id: s.id, title: s.title, artistLabel: s.artist_label });
    }
  } catch {
    /* posts.sound_id/sounds not migrated yet */
  }
  return out;
}

/**
 * Busts a viewer's first-page feed caches right after THEY publish, so their
 * new post/reel appears the moment the feed re-renders instead of after the
 * 20s TTL. Other viewers ride the TTL (freshness within 20s is by design).
 */
export async function bustHomeFeedCache(viewerId: string): Promise<void> {
  const sorts: HomeFeedSort[] = ["for_you", "following", "recent", "trending"];
  const formats = ["feed", "reel"];
  const limits = [8, 12, 24];
  // The live cache key ends with a `:${seed ?? "-"}` segment (see getHomeFeed).
  // Omitting it — as this did — deleted keys that never exist, so a publisher's
  // brand-new post sat behind the 20s TTL instead of appearing at once. The
  // no-seed variant (`:-`) covers SSR + the plain-order sorts; a seeded "for_you"
  // refresh mints a new seed and so misses the cache anyway (already fresh).
  await Promise.all(
    sorts.flatMap((s) =>
      formats.flatMap((f) => limits.map((l) => cacheDelete(`homefeed:${viewerId}:${s}:${f}:0:${l}:-`))),
    ),
  ).catch(() => {});
}

/** A page of the rich home feed. Offset-based so it powers infinite scroll. */
export async function getHomeFeed(opts: {
  viewerId: string | null;
  sort?: HomeFeedSort;
  offset?: number;
  limit?: number;
  /** Which product surface: "feed" (default — excludes reels) or "reel". */
  format?: ContentFormat;
  /** Reshuffle token for "for_you" (see `rankForYou`'s seeded jitter). ONE
   *  value per refresh, reused for every page of that refresh — the client
   *  mints it and passes it back with each page. Omit for a stable order
   *  (SSR of a non-feed surface, tests, the reels rail). */
  seed?: string;
  /**
   * Posts this viewer has already watched on this device, to be skipped.
   *
   * A PREFERENCE, not a filter: if honouring it would leave the page nearly
   * empty it is dropped for that request (see `EXCLUDE_MIN_KEPT`). Reels is the
   * caller — "never show one video twice every open" — and it must not be able
   * to empty its own deck on a small catalogue.
   */
  excludeIds?: string[];
  /**
   * Pin posts from the last 30 minutes to the top (see `rankForYou`'s
   * `pinNew`). Set by the "N new posts" pill ONLY — the one action that
   * promises the viewer specific posts. Everything else reshuffles.
   */
  pinNew?: boolean;
}): Promise<FeedPage> {
  const limit = opts.limit ?? 8;
  const offset = opts.offset ?? 0;
  const sort = opts.sort ?? "for_you";
  const format = opts.format ?? "feed";
  /*
    Which sorts reshuffle.

    "for_you" always has. Reels' "following" now does too, and the distinction
    is the SURFACE rather than the sort name: a following FEED is a timeline,
    where chronological order is the promise being made, while a following
    REELS deck is a full-screen player you swipe — nobody reads a reels deck as
    "these are in the order they were posted", and freezing its order is what
    made reopening it feel like the app had not noticed you left.

    "recent" and "trending" never reshuffle on any surface: those names describe
    a specific order, and jittering them would simply make the label a lie.
  */
  const reshuffles = sort === "for_you" || (sort === "following" && format === "reel");
  const seed = reshuffles ? opts.seed : undefined;
  // Only "for_you" ranks, so only "for_you" can pin.
  const pinNew = sort === "for_you" && opts.pinNew === true;
  const exclude = opts.excludeIds?.length ? [...new Set(opts.excludeIds)] : undefined;
  if (!hasSupabase) return emptyFeedPage();
  // Cached briefly per (viewer, sort, format, page) so SSR seeding + client
  // revalidation stay cheap. Feed freshness within 20s is fine.
  // `seed` MUST be part of the key: it changes the returned ORDER, so sharing
  // one cache entry across seeds would hand a refresh the previous refresh's
  // arrangement (and, worse, mix orders across pages mid-scroll).
  //
  // The exclusion list is part of the key for the same reason — it changes WHICH
  // items come back. It is hashed rather than inlined because it is up to 80
  // UUIDs and a 3KB cache key is a cache key nobody can read in a log; the ids
  // are already sorted before hashing so two requests differing only in the
  // order they listed the same ids still share one entry.
  const excludeKey = exclude ? fnv1a([...exclude].sort().join(",")) : "-";
  // `pinNew` joins the key for the same reason `seed` does — it changes the
  // returned ORDER, so a pill refresh and a plain one must not share an entry.
  const key = `homefeed:${opts.viewerId ?? "anon"}:${sort}:${format}:${offset}:${limit}:${seed ?? "-"}:${excludeKey}${pinNew ? ":pin" : ""}`;
  return getCached(key, 20, () => loadHomeFeed(opts.viewerId, sort, offset, limit, format, seed, exclude, pinNew));
}

/**
 * Below this many surviving posts, an exclusion list is ignored for that
 * request.
 *
 * 🔴 The failure this prevents: a viewer who has watched most of a young
 * catalogue asks for reels, every candidate is on their watched list, and the
 * deck comes back empty — which reads as "there are no reels", not as "you have
 * seen these". A repeat is a mild disappointment; an empty full-screen player
 * is a broken feature.
 */
const EXCLUDE_MIN_KEPT = 4;

/** FNV-1a over a string, hex. Used only to keep cache keys short. */
function fnv1a(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

async function loadHomeFeed(
  viewerId: string | null,
  sort: HomeFeedSort,
  offset: number,
  limit: number,
  format: ContentFormat,
  seed?: string,
  excludeIds?: string[],
  pinNew = false,
): Promise<FeedPage> {
  try {
    const db = createAdminClient();
    const settings = await getTrendingSettings();

    // "Following" feed needs the viewer's follow set first.
    let followingIds: string[] = [];
    if (viewerId) {
      const { data: follows } = await db
        .from("follows")
        .select("following_id")
        .eq("follower_id", viewerId);
      followingIds = ((follows ?? []) as { following_id: string }[]).map((f) => f.following_id);
    }
    if (sort === "following" && followingIds.length === 0) {
      return emptyFeedPage();
    }

    // Candidate window.
    //
    // For a RANKED feed ("for_you") the candidate set MUST be identical on every
    // page. Offset pagination re-runs this query per page; when the window GROWS
    // with the offset, a deeper page ranks a LARGER set, a high-engagement OLDER
    // post slots into the middle of the order, and slicing `[offset, offset+limit]`
    // then SKIPS items shifted past the boundary and REPEATS ones shifted in. On
    // the client that reads as "reels dead-ends while there are more below" (the
    // skipped tail is never requested once nextOffset goes null) and "posts
    // disappear from the feed". So for_you ranks a FIXED window — the whole recent
    // candidate pool, once — and every page slices the same stable order. The
    // plain-order sorts (following/recent/trending) never reshuffle, so their
    // cheaper grows-with-offset over-fetch stays correct.
    const RANKED_WINDOW = 400;
    /*
      A RESHUFFLED sort needs the fixed window for exactly the reason spelled out
      above, so this tracks "does the order depend on a seed", not "is this
      for_you". Reels' seeded "following" deck was the case that made the
      difference matter: with the grows-with-offset window it would have re-ranked
      a larger candidate set on every page and started skipping and repeating
      clips mid-scroll — the precise bug the fixed window exists to prevent, in a
      new sort that had never needed it before.
    */
    const fixedWindow = sort === "for_you" || seed !== undefined;
    const want = fixedWindow ? RANKED_WINDOW : (offset + limit) * 3 + limit;
    const hasMomentum = await hasMomentumColumn(db);
    let q = db
      .from("posts")
      .select(hasMomentum ? `${SELECT}, momentum_score` : SELECT)
      .eq("status", "published")
      .eq("visibility", "public")
      .limit(Math.min(want, 400));
    if (sort === "following") q = q.in("publisher_id", followingIds);
    // Feed and Reels OVERLAP on video (owner: "videos should appear on both reels
    // and feed"). Reels = every public VIDEO, whichever surface it was posted to;
    // the Feed shows everything (images, videos incl. reels, text). So a video
    // lives in both, an image only in the feed — they're not mutually exclusive.
    if (format === "reel") {
      q = q.eq("media_kind", "video");
    }
    // Base fetch order is newest-first for "following"/"recent" (an unranked,
    // literal view of what was posted) and "for_you" (re-ranked in JS below,
    // falling back to this same recency order as its tiebreak). "trending" is
    // the one sort that's a genuinely separate global signal — it orders by
    // the same admin-tunable `hot_score` (log-engagement / age^gravity,
    // recomputed nightly by `recompute_hot_scores`, see migration 0009) that
    // `lib/social/feed.ts`'s Explore feed already uses for its own "trending"
    // sort. Before this, nothing calling `getHomeFeed` ever ordered by it —
    // Home's "Trending Reels" rail passed `sort: "recent"`, so it showed the
    // newest reels, not the hottest ones, the same "label doesn't match the
    // query" bug `rankForYou` above fixed for "for_you".
    q = sort === "trending"
      ? q.order("hot_score", { ascending: false }).order("created_at", { ascending: false })
      : q.order("created_at", { ascending: false });

    const { data } = await q;
    // The select string is dynamic (`hasMomentum ? ... : ...`), so Supabase's
    // generated-type query builder can't resolve it to a literal column list
    // at compile time — hence the `unknown` hop, same as every other cast in
    // this file that reads from a possibly-unmigrated column.
    let rows = (data as unknown as Row[]) ?? [];
    if (rows.length === 0) return emptyFeedPage();

    // Discovery Controls — Sensitive Content (Feature 15 Part 8). Off by
    // default on EVERY sort, not just "for_you": this is a safety filter, not
    // a ranking personalization, so it applies the same way `blocked`/
    // `suspended` already do below — an anon viewer (no prefs row) always
    // gets the safe default.
    const prefsForViewer = viewerId ? await getHomePreferences(viewerId) : null;
    if (!prefsForViewer?.sensitiveContent) {
      rows = rows.filter((r) => !r.is_nsfw);
    }

    // Personalization (Feature 17 Part 13, extended Part 8) only ever applies
    // to "for_you" — same rule as rankForYou itself: "following"/"recent"/
    // "trending" stay a plain, literal view. A muted category is excluded
    // outright (mirrors muted_creators' absolute semantics), THEN the
    // remaining rows are ranked with the viewer's boost/relationship
    // preferences — UNLESS personalization is explicitly paused, in which
    // case "for_you" degrades to the same literal recency order "recent" uses.
    let prefs: HomePreferences | null = null;
    if (sort === "for_you") {
      prefs = prefsForViewer;
      if (prefs?.personalizationPaused) {
        // Paused: no mute filter, no ranking — exactly "recent"'s behavior.
      } else {
        if (prefs && prefs.mutedCategories.length > 0) {
          const muted = new Set(prefs.mutedCategories);
          rows = rows.filter((r) => !r.category || !muted.has(r.category as Category));
        }
        rows = rankForYou(rows, new Set(followingIds), prefs ?? undefined, seed, pinNew);
      }
    } else if (seed) {
      /*
        A seeded sort that is not "for_you" — today that is only the reels
        Following deck.

        A pure ORDER shuffle, not `rankForYou`. Following has no ranking model
        and should not grow one here: everyone in this list was chosen by the
        viewer, so scoring them against each other would quietly decide which of
        the people you follow you see, which is not a decision this function is
        entitled to make. Reordering is the whole ask; ranking would be a
        different feature wearing its clothes.
      */
      rows = [...rows].sort((a, b) => seededUnit(seed, a.id) - seededUnit(seed, b.id));
    }

    const publisherIds = [...new Set(rows.map((r) => r.publisher_id))];
    // `friendIdSet` rides IN this batch, not after it: it depends only on
    // viewerId, so awaiting it separately (as it was when 0082 added it) put a
    // whole extra sequential round trip on /home's critical path for nothing.
    // Owner's 2-second page budget — see [[rule-2-second-page-budget]].
    const [{ data: profs }, { data: privs }, { data: subs }, reactionRows, blocks, mutes, friends] = await Promise.all([
      db.from("profiles").select("id, handle, display_name, avatar_url, is_verified, is_suspended, is_hidden, trust_score").in("id", publisherIds),
      db.from("privacy_settings").select("user_id, show_in_recommendations").in("user_id", publisherIds),
      db.from("subscriptions").select("user_id, plan, status").in("user_id", publisherIds).in("status", ["active", "trialing"]),
      viewerId ? fetchReactionRows(db, viewerId, rows.map((r) => r.id)) : Promise.resolve([]),
      viewerId
        ? db.from("blocks").select("blocker_id, blocked_id").or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`)
        : Promise.resolve({ data: [] as { blocker_id: string; blocked_id: string }[] }),
      // Best-effort against migration 0035 not being applied yet — a missing
      // table just means nothing's muted, same fail-open shape as `blocks`.
      viewerId
        ? db.from("muted_creators").select("muted_id").eq("muter_id", viewerId)
        : Promise.resolve({ data: [] as { muted_id: string }[] }),
      friendIdSet(viewerId),
    ]);

    const profById = new Map<string, Record<string, unknown>>();
    for (const p of (profs ?? []) as Record<string, unknown>[]) profById.set(p.id as string, p);

    // "suspended" is the historical name for "authors this viewer can't see".
    // Since 0082 that's two different things: a suspension (nobody sees them)
    // and an admin hide (only their friends see them), so the set is now
    // per-viewer rather than absolute. `friends` comes from the batch above.
    const suspended = new Set<string>();
    const lowTrust = new Set<string>();
    for (const p of (profs ?? []) as { id: string; is_suspended: boolean; is_hidden: boolean; trust_score: number; handle: string | null }[]) {
      if (!p.handle || !isAccountVisibleTo(flagsOf(p), relationTo(p.id, viewerId, friends))) suspended.add(p.id);
      if (settings.feedTrustMin > 0 && (p.trust_score ?? 0) < settings.feedTrustMin) lowTrust.add(p.id);
    }
    const optedOut = new Set(
      ((privs ?? []) as { user_id: string; show_in_recommendations: boolean }[])
        .filter((p) => !p.show_in_recommendations)
        .map((p) => p.user_id),
    );
    const planById = new Map(((subs ?? []) as { user_id: string; plan: BillingPlan }[]).map((s) => [s.user_id, s.plan]));
    const liked = new Set<string>();
    const saved = new Set<string>();
    const emotionByPost = new Map<string, string | null>();
    for (const r of reactionRows) {
      if (r.type === "like") {
        liked.add(r.post_id);
        emotionByPost.set(r.post_id, r.emotion);
      } else if (r.type === "save") saved.add(r.post_id);
    }
    const blocked = new Set<string>();
    for (const b of (blocks.data ?? []) as { blocker_id: string; blocked_id: string }[]) {
      blocked.add(b.blocker_id === viewerId ? b.blocked_id : b.blocker_id);
    }
    // Unlike `blocked`, this is one-directional by design — only creators
    // THIS viewer muted, never the reverse.
    const muted = new Set(((mutes.data ?? []) as { muted_id: string }[]).map((m) => m.muted_id));
    const followingSet = new Set(followingIds);

    /*
      🔴 THE DIVERSITY CAP IS OFF (owner, 2026-08-17 — first "many images and
      videos i uploaded are not showing in feed", then, after an exempt-the-
      viewer-only fix still left it capping everyone else: "the feed still
      doesnt show all the media and videos i and all users have uploaded...
      all should show completely, rank by new and most liked").

      It used to cap every publisher (including the viewer) to `diversityCap`
      posts (default 2, lib/social/feed.ts) in the whole ranked 400-row
      window, applied ONCE before pagination slices it — so scrolling further
      never reached whatever got capped, which is exactly the "I see a
      Continue-in-Reels button" symptom (nextOffset going null well before
      every real post was ever shown). The owner's explicit standing
      instruction for THIS surface is comprehensiveness, not algorithmic
      diversity throttling — so nothing here caps by publisher any more.
      `lib/social/feed.ts`'s Explore feed is untouched — that surface's own
      diversity cap is a separate decision this instruction wasn't about.
    */
    const kept: FeedItem[] = [];
    for (const r of rows) {
      if (suspended.has(r.publisher_id) || lowTrust.has(r.publisher_id) || blocked.has(r.publisher_id) || muted.has(r.publisher_id)) continue;
      // Opt-outs are hidden from discovery, but a creator you follow can still appear.
      if (optedOut.has(r.publisher_id) && !followingSet.has(r.publisher_id) && r.publisher_id !== viewerId) continue;

      const prof = profById.get(r.publisher_id);
      if (!prof) continue;
      kept.push({
        id: r.id,
        title: r.title,
        description: r.description,
        platform: r.platform,
        mediaKind: r.media_kind,
        thumbnailUrl: r.thumbnail_url,
        sourceUrl: r.source_url,
        mediaUrl: r.media_url,
        streamUid: r.stream_uid ?? null,
        category: r.category,
        durationSec: r.duration_sec,
        viewsCount: r.views_count,
        likesCount: r.likes_count,
        commentsCount: r.comments_count,
        sharesCount: r.shares_count,
        savesCount: r.saves_count,
        downloadsCount: r.downloads_count,
        createdAt: r.created_at,
        momentumScore: r.momentum_score ?? 0,
        publisher: {
          id: r.publisher_id,
          handle: prof.handle as string,
          displayName: (prof.display_name as string) || `@${prof.handle as string}`,
          avatarUrl: (prof.avatar_url as string) ?? null,
          isVerified: (prof.is_verified as boolean) ?? false,
          plan: planById.get(r.publisher_id) ?? "free",
        },
        viewerLiked: liked.has(r.id),
        viewerSaved: saved.has(r.id),
        viewerReactionEmotion: emotionByPost.get(r.id) ?? null,
        isFollowing: followingSet.has(r.publisher_id),
        isOwner: viewerId === r.publisher_id,
        hasPoll: false,
      });
    }

    /*
      "Already watched" is applied HERE — after ranking, before pagination.

      Not in the SQL `WHERE`: the exclusion is conditional (see
      EXCLUDE_MIN_KEPT), and a query cannot decide to un-apply its own filter
      after seeing how little it left. Doing it in memory means the fallback is
      a two-line branch on a list already in hand rather than a second round
      trip. The candidate window is bounded at 400 rows, so the cost is a set
      lookup per row.

      It also has to run against `kept` rather than against `rows`, so that
      offsets stay meaningful: the client pages by offset into whatever this
      returns, and filtering after the slice would hand back short pages and
      leave `nextOffset` pointing at positions that no longer exist.
    */
    let visible = kept;
    if (excludeIds?.length) {
      const skip = new Set(excludeIds);
      const unseen = kept.filter((i) => !skip.has(i.id));
      if (unseen.length >= EXCLUDE_MIN_KEPT || unseen.length === kept.length) visible = unseen;
    }

    const items = visible.slice(offset, offset + limit);
    const nextOffset = visible.length > offset + limit ? offset + limit : null;

    // Flag which of the shown posts carry a poll, so only those cards fetch +
    // render it (best-effort — the polls table may not be migrated yet).
    if (items.length) {
      try {
        const { data: polls } = await db.from("post_polls").select("post_id").in("post_id", items.map((i) => i.id));
        const withPoll = new Set(((polls ?? []) as { post_id: string }[]).map((p) => p.post_id));
        for (const it of items) it.hasPoll = withPoll.has(it.id);
      } catch {
        /* polls not migrated — leave hasPoll false */
      }

      // Repost state + counts + the followed-user badge (best-effort — before
      // migration 0025 these are 0/false/empty).
      const ids = items.map((i) => i.id);
      const [reposted, counts, badges, friends, previews, storyAuthors] = await Promise.all([
        viewerReposts(ids, viewerId),
        repostCounts(ids),
        // Part 4: the viewer's relations, so a friends-only or close-friends
        // repost never becomes a badge for someone who merely follows the
        // reposter. `repostViewer` is request-cached, so the three call sites in
        // one render share one pair of round-trips.
        repostViewer(viewerId).then((v) => followedReposters(ids, followingIds, v)),
        /*
          Feature 15 Part 3 — the data Social Pulse™ was built for in Part 1 and
          never had. Added to this SAME `Promise.all` deliberately: it is a
          batched, already-narrowed read, so it costs the page no extra
          wall-clock time. It returns an empty map when the tables are
          unmigrated, when nobody the viewer follows engaged, or when there is
          no viewer at all. See lib/social/friend-activity.ts.
        */
        pulseActivityForPosts(ids, followingIds, viewerId),
        // Feature 15 Part 3 tranche 2 — the rail comment preview and story ring.
        // Same batched, already-narrowed shape as everything else in this
        // Promise.all, so they cost the page no extra wall-clock time.
        commentPreviewsForPosts(
          items.map((i) => ({ id: i.id, publisherId: i.publisher.id })),
          followingIds,
        ),
        creatorsWithActiveStories(items.map((i) => i.publisher.id)),
      ]);
      for (const it of items) {
        it.viewerReposted = reposted.has(it.id);
        it.repostsCount = counts.get(it.id) ?? 0;
        it.repostBadge = badges.get(it.id);
        it.friendActivity = friends.get(it.id);
        it.commentPreview = previews.get(it.id);
        it.publisherHasStory = storyAuthors.has(it.publisher.id);
      }

      /*
        Media dimensions — for VIDEOS as well as images (owner, 2026-08-11:
        "it just only show the exact height of the video or image").

        For an image this feeds next/image. For a video it is what lets the card
        reserve the clip's TRUE shape on the very first paint instead of guessing
        3:4 and correcting after `loadedmetadata` — which both left landscape
        clips boxed in black and moved the page under the reader when the
        correction landed. Best-effort throughout: a post with no stored
        dimensions behaves exactly as before.
      */
      const sizedIds = items.filter((i) => i.mediaKind === "image" || i.mediaKind === "video").map((i) => i.id);
      if (sizedIds.length) {
        const dims = await mediaDimensions(db, sizedIds);
        for (const it of items) {
          const d = dims.get(it.id);
          if (d) {
            it.mediaWidth = d.w;
            it.mediaHeight = d.h;
          }
        }
      }

      // Stream processing status for Stream-backed videos (best-effort — before
      // migration 0029 / the webhook firing, every video just defaults to "unknown"
      // and HLS is attempted as before).
      const streamIds = items.filter((i) => i.mediaKind === "video" && i.streamUid).map((i) => i.id);
      if (streamIds.length) {
        const status = await streamStatus(db, streamIds);
        for (const it of items) {
          const s = status.get(it.id);
          it.streamReady = s?.ready ?? false;
          it.streamFailed = s?.failed ?? false;
        }
      }

      // Album items for multi-media posts (carousels / reel albums) — ordered,
      // best-effort: empty before migration 0032 and for single-media posts.
      try {
        const { data: mediaRows } = await db
          .from("post_media")
          .select("post_id, idx, media_kind, media_url, thumbnail_url, media_width, media_height")
          .in("post_id", items.map((i) => i.id))
          .order("idx", { ascending: true });
        const byPost = new Map<string, NonNullable<FeedItem["mediaItems"]>>();
        for (const r of (mediaRows ?? []) as {
          post_id: string;
          media_kind: "image" | "video";
          media_url: string;
          thumbnail_url: string | null;
          media_width: number | null;
          media_height: number | null;
        }[]) {
          const arr = byPost.get(r.post_id) ?? [];
          arr.push({ url: r.media_url, kind: r.media_kind, thumbnailUrl: r.thumbnail_url, width: r.media_width, height: r.media_height });
          byPost.set(r.post_id, arr);
        }
        for (const it of items) {
          const arr = byPost.get(it.id);
          if (arr && arr.length > 1) it.mediaItems = arr;
        }
      } catch {
        /* post_media not migrated */
      }

      const sounds = await soundInfo(db, items.map((i) => i.id));
      if (sounds.size) {
        for (const it of items) {
          const s = sounds.get(it.id);
          if (s) it.sound = s;
        }
      }
    }

    // Surface friend reposts that aren't already in your feed (Repost spec §5): a
    // followed user's repost PULLS the original post in — near the top, tagged with
    // the "X reposted" attribution badge. First page of the For You feed only.
    // Skipped entirely when the viewer's own "fewer reposts" preference is on —
    // the most literal reading of that toggle is to stop ADDING reposts on top
    // of the organic feed, not just de-rank ones already there.
    if (offset === 0 && sort === "for_you" && viewerId && followingIds.length && !prefs?.fewerReposts) {
      try {
        const exclude = new Set(kept.map((k) => k.id));
        const surfaced = await surfaceFollowedReposts(viewerId, followingIds, exclude, 2);
        if (surfaced.length) {
          const at = Math.min(1, items.length); // after the first organic post
          items.splice(at, 0, ...surfaced);
        }
      } catch {
        /* surfacing is best-effort */
      }
    }
    return { items, nextOffset, adInterval: FEED_AD_INTERVAL };
  } catch {
    return emptyFeedPage();
  }
}

/**
 * Posts that people you FOLLOW have reposted but that aren't already in your
 * ranked feed — so a friend's repost actually brings new content in (Repost spec
 * §5). Returns fully-formed `FeedItem`s (with the "X reposted" badge attached),
 * newest-repost first. Best-effort: returns [] before migration 0025 or when
 * there's nothing to surface. Privacy still wins (suspended / blocked / your own
 * posts are dropped).
 */
/** A repost row as read by the surfacing query. 0116 columns are optional. */
interface SurfacedRepostRow {
  id?: string;
  post_id: string;
  user_id: string;
  created_at?: string;
  caption?: string | null;
  audience?: string | null;
  source_repost_id?: string | null;
  throttled_at?: string | null;
}

/**
 * People the viewer has marked as favourites — their close friends.
 *
 * Note the direction: `friend_favorites (user_id, friend_id)` means "user_id
 * pinned friend_id", so the VIEWER's favourites read `user_id = viewer`. This
 * is the opposite direction from `visibility.ts`'s `closeFriendOf`, which asks
 * who pinned the viewer. Both exist and confusing them is silent.
 */
async function viewerFavourites(
  db: ReturnType<typeof createAdminClient>,
  viewerId: string,
): Promise<Set<string>> {
  try {
    const { data } = await db.from("friend_favorites").select("friend_id").eq("user_id", viewerId);
    return new Set(((data ?? []) as { friend_id: string }[]).map((f) => f.friend_id));
  } catch {
    return new Set();
  }
}

/**
 * Categories the viewer has DELIBERATELY engaged with — liked, saved or
 * reposted. Not what they watched.
 *
 * The distinction is the privacy line `ranking.ts` draws: passive viewing is
 * observation, a like is a decision the member made and can see the
 * consequences of. Best-effort; an empty set simply removes one ranking signal.
 */
async function viewerEngagedCategories(
  db: ReturnType<typeof createAdminClient>,
  viewerId: string,
): Promise<Set<string>> {
  try {
    const { data: reactions } = await db
      .from("post_reactions")
      .select("post_id")
      .eq("user_id", viewerId)
      .order("created_at", { ascending: false })
      .limit(60);
    const ids = [...new Set(((reactions ?? []) as { post_id: string }[]).map((r) => r.post_id))];
    if (ids.length === 0) return new Set();
    const { data: posts } = await db.from("posts").select("category").in("id", ids);
    return new Set(
      ((posts ?? []) as { category: string | null }[]).map((p) => p.category).filter((c): c is string => !!c),
    );
  } catch {
    return new Set();
  }
}

async function surfaceFollowedReposts(
  viewerId: string,
  followingIds: string[],
  excludeIds: Set<string>,
  max: number,
): Promise<FeedItem[]> {
  if (followingIds.length === 0) return [];
  const db = createAdminClient();

  // Most-recent reposts by people you follow → distinct target posts not already
  // shown. Over-fetch so privacy filtering below still yields `max`.
  //
  // 🔴 Part 4: this is the query that PULLS CONTENT IN, so an unfiltered read
  // here is the worst of the four — it would put a friends-only repost in the
  // feed of everyone who follows the reposter. The audience gate runs on the
  // rows the moment they arrive, before dedupe and before anything is fetched.
  const viewer = await repostViewer(viewerId);
  const fetchReposts = (cols: string) =>
    db.from("reposts").select(cols).in("user_id", followingIds).order("created_at", { ascending: false }).limit(60);
  const rich = await fetchReposts("id, post_id, user_id, created_at, caption, audience, source_repost_id, throttled_at");
  const repRows = (rich.error
    ? ((await fetchReposts("id, post_id, user_id, created_at")).data ?? [])
    : (rich.data ?? [])) as unknown as SurfacedRepostRow[];
  const visible = filterVisibleReposts(
    repRows.map((r) => ({ ...r, audience: (r.audience ?? "public") as RepostAudience })),
    viewer,
  ).filter((r) => !r.throttled_at);

  const wantIds: string[] = [];
  const dedupe = new Set<string>();
  for (const r of visible) {
    if (excludeIds.has(r.post_id) || dedupe.has(r.post_id)) continue;
    dedupe.add(r.post_id);
    wantIds.push(r.post_id);
    if (wantIds.length >= max * 3) break;
  }
  if (wantIds.length === 0) return [];

  // Surfacing feeds the FEED — reposted reels stay in the Reels product.
  let repostQ = db.from("posts").select(SELECT).in("id", wantIds);
  if (await hasFormatColumn(db)) repostQ = repostQ.neq("format", "reel");
  const { data: postRows } = await repostQ;
  let rows = ((postRows ?? []) as Row[]).filter(
    (r) => r.status === "published" && r.visibility === "public" && r.publisher_id !== viewerId,
  );
  // Preserve repost-recency order (the `.in()` query returns rows unordered).
  rows.sort((a, b) => wantIds.indexOf(a.id) - wantIds.indexOf(b.id));
  if (rows.length === 0) return [];

  const publisherIds = [...new Set(rows.map((r) => r.publisher_id))];
  // friendIdSet rides IN the batch — it only needs viewerId, so awaiting it
  // after this was a free extra round trip (see the same fix in loadHomeFeed).
  const [{ data: profs }, { data: subs }, reactionRows, { data: blocks }, friends] = await Promise.all([
    db.from("profiles").select("id, handle, display_name, avatar_url, is_verified, is_suspended, is_hidden").in("id", publisherIds),
    db.from("subscriptions").select("user_id, plan").in("user_id", publisherIds).in("status", ["active", "trialing"]),
    fetchReactionRows(db, viewerId, rows.map((r) => r.id)),
    db.from("blocks").select("blocker_id, blocked_id").or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`),
    friendIdSet(viewerId),
  ]);

  const profById = new Map<string, Record<string, unknown>>();
  const suspended = new Set<string>();
  for (const p of (profs ?? []) as { id: string; handle: string | null; is_suspended: boolean; is_hidden: boolean }[]) {
    profById.set(p.id, p as unknown as Record<string, unknown>);
    // Per-viewer since 0082: a hidden author is filtered for strangers, kept for friends.
    if (!p.handle || !isAccountVisibleTo(flagsOf(p), relationTo(p.id, viewerId, friends))) suspended.add(p.id);
  }
  const planById = new Map(((subs ?? []) as { user_id: string; plan: BillingPlan }[]).map((s) => [s.user_id, s.plan]));
  const blocked = new Set<string>();
  for (const b of (blocks ?? []) as { blocker_id: string; blocked_id: string }[]) {
    blocked.add(b.blocker_id === viewerId ? b.blocked_id : b.blocker_id);
  }
  const liked = new Set<string>();
  const saved = new Set<string>();
  const emotionByPost = new Map<string, string | null>();
  for (const r of reactionRows) {
    if (r.type === "like") {
      liked.add(r.post_id);
      emotionByPost.set(r.post_id, r.emotion);
    } else if (r.type === "save") saved.add(r.post_id);
  }

  rows = rows.filter((r) => !suspended.has(r.publisher_id) && !blocked.has(r.publisher_id));
  if (rows.length === 0) return [];

  /*
    ── Ranked, not newest-first (Feature 15 Part 4) ─────────────────────────
    Until now this took whatever had been reposted most recently. `ranking.ts`
    scores each candidate and then applies the ceilings that actually stop a
    feed flooding: one repost per person, one per creator, never the same post
    twice. Ordering is the smaller half of that.

    🔴 Strength is computed from the relationship facts THIS FUNCTION ALREADY
    HAS — friend, follow, favourite. The full `relationshipStrength` also weighs
    message and engagement recency, which is a per-person query pair, and a feed
    page cannot afford one per candidate. Feeding it the fields we have is
    honest (it treats a missing history as unknown, not as zero) and reuses the
    reviewed scale instead of inventing a second one here.

    Mutual friends are deliberately left at 0 for the same reason: real, but not
    worth a query per candidate on the hot path.
  */
  const [favouritesOfViewer, viewerInterests] = await Promise.all([
    viewerFavourites(db, viewerId),
    viewerEngagedCategories(db, viewerId),
  ]);
  const repostsByPost = new Map<string, typeof visible>();
  for (const r of visible) {
    const arr = repostsByPost.get(r.post_id) ?? [];
    arr.push(r);
    repostsByPost.set(r.post_id, arr);
  }

  const strength = new Map<string, number>();
  for (const r of visible) {
    if (strength.has(r.user_id)) continue;
    strength.set(
      r.user_id,
      relationshipStrength({
        isFriend: friends.has(r.user_id),
        isFollowing: followingIds.includes(r.user_id),
        followsBack: false,
        isFavorite: favouritesOfViewer.has(r.user_id),
        sharedCircles: 0,
        mutualFriends: 0,
        daysSinceMessage: null,
        daysSinceViewerEngaged: null,
        daysKnown: null,
      }).score,
    );
  }

  const rowById = new Map(rows.map((r) => [r.id, r]));
  const candidates: RepostCandidate[] = [];
  for (const [postId, reposts] of repostsByPost) {
    const post = rowById.get(postId);
    if (!post) continue;
    // The strongest tie is the one whose recommendation this is.
    const lead = [...reposts].sort((a, b) => (strength.get(b.user_id) ?? 0) - (strength.get(a.user_id) ?? 0))[0]!;
    candidates.push({
      repostId: lead.id ?? postId,
      postId,
      reposterId: lead.user_id,
      creatorId: post.publisher_id,
      createdAt: Date.parse(lead.created_at ?? "") || Date.now(),
      audience: (lead.audience ?? "public") as RepostAudience,
      hasCaption: !!lead.caption,
      reposterCount: new Set(reposts.map((x) => x.user_id)).size,
      sourceRepostId: lead.source_repost_id ?? null,
      category: (post.category as string | null) ?? null,
    });
  }

  const ranked = rankReposts(candidates, {
    strength,
    mutualFriends: new Map(),
    closeFriends: favouritesOfViewer,
    interests: viewerInterests,
    followedCreators: new Set(followingIds),
    reputation: new Map(), // derived per read; too costly per candidate here
    excludedPostIds: excludeIds,
    dismissedPostIds: new Set(),
    now: Date.now(),
  }, { maxPerPage: max, maxPerReposter: 1, maxPerCreator: 1 });

  const signalsByPost = new Map(ranked.map((r) => [r.candidate.postId, r]));
  rows = ranked.map((r) => rowById.get(r.candidate.postId)!).filter(Boolean);
  if (rows.length === 0) return [];

  // The viewer follows the REPOSTER, not necessarily the original author — so the
  // card's follow state must reflect the actual author relationship.
  const followingSet = new Set(followingIds);

  const ids = rows.map((r) => r.id);
  // Videos as well as images — a surfaced repost renders through the same feed
  // card, so it needs the same exact-height treatment (see `mediaDimensions`).
  const sizedIds = rows.filter((r) => r.media_kind === "image" || r.media_kind === "video").map((r) => r.id);
  const streamIds = rows.filter((r) => r.media_kind === "video" && r.stream_uid).map((r) => r.id);
  const [badges, counts, reposted, pollSet, dims, streamStat, pulses] = await Promise.all([
    followedReposters(ids, followingIds, viewer),
    repostCounts(ids),
    viewerReposts(ids, viewerId),
    (async () => {
      try {
        const { data } = await db.from("post_polls").select("post_id").in("post_id", ids);
        return new Set(((data ?? []) as { post_id: string }[]).map((p) => p.post_id));
      } catch {
        return new Set<string>();
      }
    })(),
    mediaDimensions(db, sizedIds),
    streamStatus(db, streamIds),
    // Feature 15 Part 3 — see the note at the other attach site above.
    pulseActivityForPosts(ids, followingIds, viewerId),
  ]);

  /*
    The reason each of these is here, built from the ranking's OWN signals plus
    the names the badge query already resolved — no extra round-trip, and no
    second opinion about why the item was picked.

    `repostReason` can legitimately come back null (nothing nameable and no
    signal that fired). That is left absent rather than replaced with a generic
    line: a card with no explanation is honest, an invented one is not.
  */
  const reasonByPost = new Map<string, ReturnType<typeof repostReason>>();
  for (const r of rows) {
    const scored = signalsByPost.get(r.id);
    const badge = badges.get(r.id);
    if (!scored) continue;
    reasonByPost.set(
      r.id,
      repostReason({
        signals: scored.signals,
        reposterNames: (badge?.handles ?? []).map((h) => `@${h}`),
        reposterCount: badge?.count ?? scored.candidate.reposterCount,
        categoryLabel: r.category,
      }),
    );
  }

  return rows.map((r) => {
    const prof = profById.get(r.publisher_id) as Record<string, unknown>;
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      platform: r.platform,
      mediaKind: r.media_kind,
      thumbnailUrl: r.thumbnail_url,
      sourceUrl: r.source_url,
      mediaUrl: r.media_url,
      streamUid: r.stream_uid ?? null,
      category: r.category,
      durationSec: r.duration_sec,
      viewsCount: r.views_count,
      likesCount: r.likes_count,
      commentsCount: r.comments_count,
      sharesCount: r.shares_count,
      savesCount: r.saves_count,
      downloadsCount: r.downloads_count,
      createdAt: r.created_at,
      publisher: {
        id: r.publisher_id,
        handle: prof.handle as string,
        displayName: (prof.display_name as string) || `@${prof.handle as string}`,
        avatarUrl: (prof.avatar_url as string) ?? null,
        isVerified: (prof.is_verified as boolean) ?? false,
        plan: planById.get(r.publisher_id) ?? "free",
      },
      viewerLiked: liked.has(r.id),
      viewerSaved: saved.has(r.id),
      viewerReactionEmotion: emotionByPost.get(r.id) ?? null,
      isFollowing: followingSet.has(r.publisher_id),
      isOwner: false,
      hasPoll: pollSet.has(r.id),
      viewerReposted: reposted.has(r.id),
      repostsCount: counts.get(r.id) ?? 0,
      repostBadge: badges.get(r.id),
      repostReason: reasonByPost.get(r.id) ?? undefined,
      viaRepostId: signalsByPost.get(r.id)?.candidate.repostId,
      friendActivity: pulses.get(r.id),
      mediaWidth: dims.get(r.id)?.w ?? null,
      mediaHeight: dims.get(r.id)?.h ?? null,
      streamReady: streamStat.get(r.id)?.ready ?? false,
      streamFailed: streamStat.get(r.id)?.failed ?? false,
    };
  });
}
