import type { BillingPlan } from "@/lib/monetization/types";
import { createAdminClient } from "@/lib/supabase/admin";

import { getTrendingSettings } from "./feed";
import type { MediaKind } from "./posts";

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
  views_count: number;
  likes_count: number;
  saves_count: number;
  shares_count: number;
  comments_count: number;
  downloads_count: number;
  created_at: string;
}

const SELECT =
  "id, publisher_id, source_url, platform, media_kind, title, description, category, thumbnail_url, media_url, duration_sec, visibility, status, views_count, likes_count, saves_count, shares_count, comments_count, downloads_count, created_at";

export type HomeFeedSort = "for_you" | "following" | "recent";

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

  try {
    const db = createAdminClient();
    const settings = await getTrendingSettings();

    // "Following" feed needs the viewer's follow set first.
    let followingIds: string[] = [];
    if (opts.viewerId) {
      const { data: follows } = await db
        .from("follows")
        .select("following_id")
        .eq("follower_id", opts.viewerId);
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
    q = sort === "recent"
      ? q.order("created_at", { ascending: false })
      : q.order("hot_score", { ascending: false }).order("created_at", { ascending: false });

    const { data } = await q;
    const rows = (data as Row[]) ?? [];
    if (rows.length === 0) return { items: [], nextOffset: null };

    const publisherIds = [...new Set(rows.map((r) => r.publisher_id))];
    const [{ data: profs }, { data: privs }, { data: subs }, reactions, blocks] = await Promise.all([
      db.from("profiles").select("id, handle, display_name, avatar_url, is_verified, is_suspended, trust_score").in("id", publisherIds),
      db.from("privacy_settings").select("user_id, show_in_recommendations").in("user_id", publisherIds),
      db.from("subscriptions").select("user_id, plan, status").in("user_id", publisherIds).in("status", ["active", "trialing"]),
      opts.viewerId
        ? db.from("post_reactions").select("post_id, type").eq("user_id", opts.viewerId).in("post_id", rows.map((r) => r.id))
        : Promise.resolve({ data: [] as { post_id: string; type: string }[] }),
      opts.viewerId
        ? db.from("blocks").select("blocker_id, blocked_id").or(`blocker_id.eq.${opts.viewerId},blocked_id.eq.${opts.viewerId}`)
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
      blocked.add(b.blocker_id === opts.viewerId ? b.blocked_id : b.blocker_id);
    }
    const followingSet = new Set(followingIds);

    const perPublisher = new Map<string, number>();
    const kept: FeedItem[] = [];
    for (const r of rows) {
      if (suspended.has(r.publisher_id) || lowTrust.has(r.publisher_id) || blocked.has(r.publisher_id)) continue;
      // Opt-outs are hidden from discovery, but a creator you follow can still appear.
      if (optedOut.has(r.publisher_id) && !followingSet.has(r.publisher_id) && r.publisher_id !== opts.viewerId) continue;
      const n = perPublisher.get(r.publisher_id) ?? 0;
      if (n >= Math.max(settings.diversityCap, 2)) continue;
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
        isOwner: opts.viewerId === r.publisher_id,
      });
    }

    const items = kept.slice(offset, offset + limit);
    const nextOffset = kept.length > offset + limit ? offset + limit : null;
    return { items, nextOffset };
  } catch {
    return { items: [], nextOffset: null };
  }
}
