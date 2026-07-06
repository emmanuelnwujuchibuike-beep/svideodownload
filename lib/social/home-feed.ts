import { getCached } from "@/lib/cache";
import type { BillingPlan } from "@/lib/monetization/types";
import { createAdminClient } from "@/lib/supabase/admin";

import { getTrendingSettings } from "./feed";
import type { MediaKind } from "./posts";
import { followedReposters, repostCounts, viewerReposts } from "./reposts";

/**
 * Rich, privacy-filtered home feed. Unlike the lean Explore `getFeed`, each item
 * carries the publisher card, engagement counts, and the viewer's like/save/
 * follow state so the dashboard feed can render fully without N extra requests.
 * Privacy always wins (suspended / opted-out / blocked publishers are removed)
 * and a per-publisher diversity cap keeps one creator from flooding the feed.
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
  publisher: FeedPublisher;
  viewerLiked: boolean;
  viewerSaved: boolean;
  isFollowing: boolean;
  isOwner: boolean;
  /** True when the post carries a poll (vote) — the card fetches + renders it. */
  hasPoll: boolean;
  /** Repost state — optional/best-effort (0/false before the reposts migration). */
  viewerReposted?: boolean;
  repostsCount?: number;
  /** Followed users who reposted this — the premium repost badge (avatars + "+N"). */
  repostBadge?: { avatars: (string | null)[]; handles: string[]; count: number };
  /** Natural pixel size of an image post — lets the feed render it with next/image. */
  mediaWidth?: number | null;
  mediaHeight?: number | null;
}

export interface FeedPage {
  items: FeedItem[];
  nextOffset: number | null;
}

interface Row {
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
}

const SELECT =
  "id, publisher_id, source_url, platform, media_kind, title, description, category, thumbnail_url, media_url, stream_uid, duration_sec, visibility, status, views_count, likes_count, saves_count, shares_count, comments_count, downloads_count, created_at";

export type HomeFeedSort = "for_you" | "following" | "recent";

/**
 * A single feed item by post id, in the exact `FeedItem` shape the reel deck
 * expects — used to deep-link straight into `/reels?start=<id>` (e.g. tapping a
 * video from the home feed or the trending rail) without waiting on the full
 * paginated query. Returns null for anything private, missing, or non-video.
 */
export async function getFeedItemById(id: string, viewerId: string | null): Promise<FeedItem | null> {
  if (!hasSupabase) return null;
  try {
    const db = createAdminClient();
    const { data } = await db.from("posts").select(SELECT).eq("id", id).maybeSingle();
    const row = data as Row | null;
    if (!row || row.status !== "published" || row.visibility !== "public" || row.media_kind !== "video") return null;

    const { data: prof } = await db
      .from("profiles")
      .select("id, handle, display_name, avatar_url, is_verified, is_suspended")
      .eq("id", row.publisher_id)
      .maybeSingle();
    if (!prof || !prof.handle || prof.is_suspended) return null;

    const { data: subs } = await db
      .from("subscriptions")
      .select("plan")
      .eq("user_id", row.publisher_id)
      .in("status", ["active", "trialing"])
      .maybeSingle();

    let viewerLiked = false;
    let viewerSaved = false;
    let isFollowing = false;
    if (viewerId) {
      const [{ count: blockedCount }, { data: reactions }, { count: followCount }] = await Promise.all([
        db
          .from("blocks")
          .select("blocker_id", { head: true, count: "exact" })
          .or(`and(blocker_id.eq.${row.publisher_id},blocked_id.eq.${viewerId}),and(blocker_id.eq.${viewerId},blocked_id.eq.${row.publisher_id})`),
        db.from("post_reactions").select("type").eq("user_id", viewerId).eq("post_id", id),
        db.from("follows").select("follower_id", { head: true, count: "exact" }).eq("follower_id", viewerId).eq("following_id", row.publisher_id),
      ]);
      if ((blockedCount ?? 0) > 0) return null;
      for (const r of (reactions ?? []) as { type: string }[]) {
        if (r.type === "like") viewerLiked = true;
        else if (r.type === "save") viewerSaved = true;
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
      isFollowing,
      isOwner: viewerId === row.publisher_id,
      hasPoll,
      viewerReposted: (await viewerReposts([id], viewerId)).has(id),
      repostsCount: (await repostCounts([id])).get(id) ?? 0,
    };
  } catch {
    return null;
  }
}

/** Natural pixel sizes for image posts (best-effort — empty before migration 0028). */
async function imageDimensions(
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

/** A page of the rich home feed. Offset-based so it powers infinite scroll. */
export async function getHomeFeed(opts: {
  viewerId: string | null;
  sort?: HomeFeedSort;
  offset?: number;
  limit?: number;
}): Promise<FeedPage> {
  const limit = opts.limit ?? 8;
  const offset = opts.offset ?? 0;
  const sort = opts.sort ?? "for_you";
  if (!hasSupabase) return { items: [], nextOffset: null };
  // Cached briefly per (viewer, sort, page) so SSR seeding + client revalidation
  // stay cheap. Feed freshness within 20s is fine.
  const key = `homefeed:${opts.viewerId ?? "anon"}:${sort}:${offset}:${limit}`;
  return getCached(key, 20, () => loadHomeFeed(opts.viewerId, sort, offset, limit));
}

async function loadHomeFeed(
  viewerId: string | null,
  sort: HomeFeedSort,
  offset: number,
  limit: number,
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
      return { items: [], nextOffset: null };
    }

    // Over-fetch to absorb privacy/diversity filtering + the requested offset.
    const want = (offset + limit) * 3 + limit;
    let q = db
      .from("posts")
      .select(SELECT)
      .eq("status", "published")
      .eq("visibility", "public")
      .limit(Math.min(want, 400));
    if (sort === "following") q = q.in("publisher_id", followingIds);
    // Newest first, always — the feed and reels (which share this query) should
    // show what was actually posted most recently at the top, not whatever
    // ranks highest by engagement.
    q = q.order("created_at", { ascending: false });

    const { data } = await q;
    const rows = (data as Row[]) ?? [];
    if (rows.length === 0) return { items: [], nextOffset: null };

    const publisherIds = [...new Set(rows.map((r) => r.publisher_id))];
    const [{ data: profs }, { data: privs }, { data: subs }, reactions, blocks] = await Promise.all([
      db.from("profiles").select("id, handle, display_name, avatar_url, is_verified, is_suspended, trust_score").in("id", publisherIds),
      db.from("privacy_settings").select("user_id, show_in_recommendations").in("user_id", publisherIds),
      db.from("subscriptions").select("user_id, plan, status").in("user_id", publisherIds).in("status", ["active", "trialing"]),
      viewerId
        ? db.from("post_reactions").select("post_id, type").eq("user_id", viewerId).in("post_id", rows.map((r) => r.id))
        : Promise.resolve({ data: [] as { post_id: string; type: string }[] }),
      viewerId
        ? db.from("blocks").select("blocker_id, blocked_id").or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`)
        : Promise.resolve({ data: [] as { blocker_id: string; blocked_id: string }[] }),
    ]);

    const profById = new Map<string, Record<string, unknown>>();
    for (const p of (profs ?? []) as Record<string, unknown>[]) profById.set(p.id as string, p);

    const suspended = new Set<string>();
    const lowTrust = new Set<string>();
    for (const p of (profs ?? []) as { id: string; is_suspended: boolean; trust_score: number; handle: string | null }[]) {
      if (p.is_suspended || !p.handle) suspended.add(p.id);
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
    for (const r of (reactions.data ?? []) as { post_id: string; type: string }[]) {
      if (r.type === "like") liked.add(r.post_id);
      else if (r.type === "save") saved.add(r.post_id);
    }
    const blocked = new Set<string>();
    for (const b of (blocks.data ?? []) as { blocker_id: string; blocked_id: string }[]) {
      blocked.add(b.blocker_id === viewerId ? b.blocked_id : b.blocker_id);
    }
    const followingSet = new Set(followingIds);

    // Per-publisher diversity cap keeps one creator from flooding the feed — but
    // on a small creator base it starves it (2 creators × cap 2 = only 4 posts).
    // So relax the cap hard when there are few distinct creators to show.
    const distinctPublishers = new Set(rows.map((r) => r.publisher_id)).size;
    const diversityCap = distinctPublishers <= 8 ? 1000 : Math.max(settings.diversityCap, 2);

    const perPublisher = new Map<string, number>();
    const kept: FeedItem[] = [];
    for (const r of rows) {
      if (suspended.has(r.publisher_id) || lowTrust.has(r.publisher_id) || blocked.has(r.publisher_id)) continue;
      // Opt-outs are hidden from discovery, but a creator you follow can still appear.
      if (optedOut.has(r.publisher_id) && !followingSet.has(r.publisher_id) && r.publisher_id !== viewerId) continue;
      const n = perPublisher.get(r.publisher_id) ?? 0;
      if (n >= diversityCap) continue;
      perPublisher.set(r.publisher_id, n + 1);

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
        isFollowing: followingSet.has(r.publisher_id),
        isOwner: viewerId === r.publisher_id,
        hasPoll: false,
      });
    }

    const items = kept.slice(offset, offset + limit);
    const nextOffset = kept.length > offset + limit ? offset + limit : null;

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
      const [reposted, counts, badges] = await Promise.all([
        viewerReposts(ids, viewerId),
        repostCounts(ids),
        followedReposters(ids, followingIds),
      ]);
      for (const it of items) {
        it.viewerReposted = reposted.has(it.id);
        it.repostsCount = counts.get(it.id) ?? 0;
        it.repostBadge = badges.get(it.id);
      }

      // Image dimensions for the feed photo's next/image (best-effort — before
      // migration 0028 this no-ops and the photo falls back to a plain <img>).
      const imageIds = items.filter((i) => i.mediaKind === "image").map((i) => i.id);
      if (imageIds.length) {
        const dims = await imageDimensions(db, imageIds);
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
    }

    // Surface friend reposts that aren't already in your feed (Repost spec §5): a
    // followed user's repost PULLS the original post in — near the top, tagged with
    // the "X reposted" attribution badge. First page of the For You feed only.
    if (offset === 0 && sort === "for_you" && viewerId && followingIds.length) {
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
    return { items, nextOffset };
  } catch {
    return { items: [], nextOffset: null };
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
  const { data: repRows } = await db
    .from("reposts")
    .select("post_id, user_id, created_at")
    .in("user_id", followingIds)
    .order("created_at", { ascending: false })
    .limit(60);
  const wantIds: string[] = [];
  const dedupe = new Set<string>();
  for (const r of (repRows ?? []) as { post_id: string }[]) {
    if (excludeIds.has(r.post_id) || dedupe.has(r.post_id)) continue;
    dedupe.add(r.post_id);
    wantIds.push(r.post_id);
    if (wantIds.length >= max * 3) break;
  }
  if (wantIds.length === 0) return [];

  const { data: postRows } = await db.from("posts").select(SELECT).in("id", wantIds);
  let rows = ((postRows ?? []) as Row[]).filter(
    (r) => r.status === "published" && r.visibility === "public" && r.publisher_id !== viewerId,
  );
  // Preserve repost-recency order (the `.in()` query returns rows unordered).
  rows.sort((a, b) => wantIds.indexOf(a.id) - wantIds.indexOf(b.id));
  if (rows.length === 0) return [];

  const publisherIds = [...new Set(rows.map((r) => r.publisher_id))];
  const [{ data: profs }, { data: subs }, { data: reactions }, { data: blocks }] = await Promise.all([
    db.from("profiles").select("id, handle, display_name, avatar_url, is_verified, is_suspended").in("id", publisherIds),
    db.from("subscriptions").select("user_id, plan").in("user_id", publisherIds).in("status", ["active", "trialing"]),
    db.from("post_reactions").select("post_id, type").eq("user_id", viewerId).in("post_id", rows.map((r) => r.id)),
    db.from("blocks").select("blocker_id, blocked_id").or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`),
  ]);

  const profById = new Map<string, Record<string, unknown>>();
  const suspended = new Set<string>();
  for (const p of (profs ?? []) as { id: string; handle: string | null; is_suspended: boolean }[]) {
    profById.set(p.id, p as unknown as Record<string, unknown>);
    if (p.is_suspended || !p.handle) suspended.add(p.id);
  }
  const planById = new Map(((subs ?? []) as { user_id: string; plan: BillingPlan }[]).map((s) => [s.user_id, s.plan]));
  const blocked = new Set<string>();
  for (const b of (blocks ?? []) as { blocker_id: string; blocked_id: string }[]) {
    blocked.add(b.blocker_id === viewerId ? b.blocked_id : b.blocker_id);
  }
  const liked = new Set<string>();
  const saved = new Set<string>();
  for (const r of (reactions ?? []) as { post_id: string; type: string }[]) {
    if (r.type === "like") liked.add(r.post_id);
    else if (r.type === "save") saved.add(r.post_id);
  }

  rows = rows.filter((r) => !suspended.has(r.publisher_id) && !blocked.has(r.publisher_id)).slice(0, max);
  if (rows.length === 0) return [];

  // The viewer follows the REPOSTER, not necessarily the original author — so the
  // card's follow state must reflect the actual author relationship.
  const followingSet = new Set(followingIds);

  const ids = rows.map((r) => r.id);
  const imageIds = rows.filter((r) => r.media_kind === "image").map((r) => r.id);
  const streamIds = rows.filter((r) => r.media_kind === "video" && r.stream_uid).map((r) => r.id);
  const [badges, counts, reposted, pollSet, dims, streamStat] = await Promise.all([
    followedReposters(ids, followingIds),
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
    imageDimensions(db, imageIds),
    streamStatus(db, streamIds),
  ]);

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
      isFollowing: followingSet.has(r.publisher_id),
      isOwner: false,
      hasPoll: pollSet.has(r.id),
      viewerReposted: reposted.has(r.id),
      repostsCount: counts.get(r.id) ?? 0,
      repostBadge: badges.get(r.id),
      mediaWidth: dims.get(r.id)?.w ?? null,
      mediaHeight: dims.get(r.id)?.h ?? null,
      streamReady: streamStat.get(r.id)?.ready ?? false,
      streamFailed: streamStat.get(r.id)?.failed ?? false,
    };
  });
}
