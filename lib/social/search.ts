import { createAdminClient } from "@/lib/supabase/admin";

import { flagsOf, isAccountVisibleTo, relationTo } from "./account-visibility";
import { friendIdSet } from "./friend-ids";
import type { MediaKind, PostCard } from "./posts";

/**
 * Universal search — people + posts (videos/reels, photos, audio) + hashtags.
 * Public, privacy-safe reads via the service role. Text is sanitised before it
 * goes into PostgREST `or(...ilike...)` filters so punctuation can't break them.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Strip characters that would break a PostgREST `or`/`ilike` filter. */
function clean(q: string): string {
  return q.replace(/[,%()*]/g, " ").replace(/#/g, "").trim().slice(0, 60);
}

export interface SearchPerson {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  isVerified: boolean;
  followersCount: number;
  /** Whether the viewer already follows them — so we never re-offer "Follow". */
  isFollowing: boolean;
}

export async function searchPeople(q: string, limit = 12, viewerId: string | null = null): Promise<SearchPerson[]> {
  if (!hasSupabase) return [];
  const term = clean(q);
  if (!term) return [];
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("profiles")
      .select("id, handle, display_name, avatar_url, is_verified, followers_count, is_suspended, is_hidden")
      .or(`handle.ilike.%${term}%,display_name.ilike.%${term}%`)
      .order("followers_count", { ascending: false })
      .limit(limit * 2);
    // A hidden account is unsearchable for strangers but must stay findable by
    // its own friends (0082) — being unable to search up a friend you already
    // chat with would be a bug, not privacy.
    const friends = await friendIdSet(viewerId);
    const people = ((data ?? []) as Record<string, unknown>[])
      .filter((p) => p.handle && isAccountVisibleTo(flagsOf(p), relationTo(p.id as string, viewerId, friends)))
      .slice(0, limit);

    // Which of these the viewer already follows.
    let followingSet = new Set<string>();
    if (viewerId && people.length) {
      const { data: follows } = await db
        .from("follows")
        .select("following_id")
        .eq("follower_id", viewerId)
        .in("following_id", people.map((p) => p.id as string));
      followingSet = new Set(((follows ?? []) as { following_id: string }[]).map((f) => f.following_id));
    }

    return people.map((p) => ({
      id: p.id as string,
      handle: p.handle as string,
      displayName: (p.display_name as string) || `@${p.handle as string}`,
      avatarUrl: (p.avatar_url as string) ?? null,
      isVerified: (p.is_verified as boolean) ?? false,
      followersCount: (p.followers_count as number) ?? 0,
      isFollowing: followingSet.has(p.id as string),
    }));
  } catch {
    return [];
  }
}

const SEARCH_SELECT =
  "id, title, platform, media_kind, thumbnail_url, media_url, category, views_count, likes_count, comments_count, created_at";

export async function searchPosts(q: string, opts: { kind?: MediaKind; limit?: number } = {}): Promise<PostCard[]> {
  if (!hasSupabase) return [];
  const term = clean(q);
  if (!term) return [];
  try {
    let query = createAdminClient()
      .from("posts")
      .select(SEARCH_SELECT)
      .eq("status", "published")
      .eq("visibility", "public")
      .or(`title.ilike.%${term}%,description.ilike.%${term}%,category.ilike.%${term}%`)
      .order("hot_score", { ascending: false })
      .limit(opts.limit ?? 24);
    if (opts.kind) query = query.eq("media_kind", opts.kind);
    const { data } = await query;
    return ((data ?? []) as Record<string, unknown>[]).map((p) => ({
      id: p.id as string,
      title: p.title as string,
      platform: p.platform as string,
      mediaKind: p.media_kind as MediaKind,
      thumbnailUrl: (p.thumbnail_url as string) ?? null,
      mediaUrl: (p.media_url as string) ?? null,
      category: (p.category as string) ?? null,
      viewsCount: (p.views_count as number) ?? 0,
      likesCount: (p.likes_count as number) ?? 0,
      commentsCount: (p.comments_count as number) ?? 0,
      createdAt: p.created_at as string,
    }));
  } catch {
    return [];
  }
}

export type SearchType = "all" | "people" | "video" | "image" | "audio";

export interface SearchResult {
  people: SearchPerson[];
  posts: PostCard[];
}

export async function searchAll(q: string, type: SearchType, viewerId: string | null = null): Promise<SearchResult> {
  const term = clean(q);
  if (!term) return { people: [], posts: [] };
  if (type === "people") return { people: await searchPeople(q, 30, viewerId), posts: [] };
  if (type === "video" || type === "image" || type === "audio") {
    return { people: [], posts: await searchPosts(q, { kind: type, limit: 30 }) };
  }
  const [people, posts] = await Promise.all([searchPeople(q, 8, viewerId), searchPosts(q, { limit: 24 })]);
  return { people, posts };
}
