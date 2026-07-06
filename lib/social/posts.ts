import { createHash } from "node:crypto";

import { getCached } from "@/lib/cache";
import { createAdminClient } from "@/lib/supabase/admin";

import { type Category } from "./categories";

/**
 * Published-download ("post") data layer — directory model: metadata + a source
 * reference only, never the media file. Reads use the service role and apply
 * post/profile visibility + blocks in code (privacy always overrides). Writes
 * are trust-gated and deduped.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export type MediaKind = "video" | "image" | "audio";
export type Visibility = "public" | "followers" | "private";

/** Normalises a source URL for dedupe (strip tracking params + trailing slash). */
function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|igshid|si|ref)/i.test(k)) u.searchParams.delete(k);
    }
    // Lowercase only the host — platform video IDs in the path are case-sensitive.
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname}${u.search}`.replace(/\/$/, "");
  } catch {
    return raw.trim();
  }
}
const urlHash = (raw: string) => createHash("sha256").update(normalizeUrl(raw)).digest("hex");

/* ----------------------------- content settings ------------------------- */

export interface ContentSettings {
  publishingEnabled: boolean;
  publishTrustMin: number;
}
const DEFAULT_CONTENT: ContentSettings = { publishingEnabled: true, publishTrustMin: 0 };

export async function getContentSettings(): Promise<ContentSettings> {
  if (!hasSupabase) return DEFAULT_CONTENT;
  try {
    const { data } = await createAdminClient()
      .from("settings")
      .select("value")
      .eq("key", "content")
      .maybeSingle();
    return { ...DEFAULT_CONTENT, ...((data?.value ?? {}) as Partial<ContentSettings>) };
  } catch {
    return DEFAULT_CONTENT;
  }
}

/* --------------------------------- publish ------------------------------ */

export interface PublishInput {
  sourceUrl: string;
  platform: string;
  sourceAuthor?: string | null;
  mediaKind: MediaKind;
  title: string;
  description?: string | null;
  category?: Category | null;
  thumbnailUrl?: string | null;
  durationSec?: number | null;
  visibility?: Visibility;
  /** Natural pixel size of an uploaded image (lets the feed use next/image). */
  mediaWidth?: number | null;
  mediaHeight?: number | null;
}

export type PublishResult =
  | { ok: true; id: string }
  | { ok: false; error: string; code: "forbidden" | "duplicate" | "disabled" | "error" };

export async function publishPost(
  publisherId: string,
  input: PublishInput,
): Promise<PublishResult> {
  if (!hasSupabase) return { ok: false, error: "Unavailable.", code: "error" };
  try {
    const db = createAdminClient();

    const settings = await getContentSettings();
    if (!settings.publishingEnabled) {
      return { ok: false, error: "Publishing is currently disabled.", code: "disabled" };
    }

    // Account must be in good standing + meet the trust threshold.
    const { data: prof } = await db
      .from("profiles")
      .select("is_suspended, trust_score, handle")
      .eq("id", publisherId)
      .maybeSingle();
    if (!prof || prof.is_suspended) {
      return { ok: false, error: "Your account can't publish right now.", code: "forbidden" };
    }
    if ((prof.trust_score ?? 0) < settings.publishTrustMin) {
      return { ok: false, error: "Your account isn't eligible to publish yet.", code: "forbidden" };
    }
    if (!prof.handle) {
      return { ok: false, error: "Set a username (handle) before publishing.", code: "forbidden" };
    }

    const { data, error } = await db
      .from("posts")
      .insert({
        publisher_id: publisherId,
        source_url: input.sourceUrl.trim(),
        source_url_hash: urlHash(input.sourceUrl),
        platform: input.platform,
        source_author: input.sourceAuthor ?? null,
        media_kind: input.mediaKind,
        title: input.title.trim().slice(0, 300),
        description: input.description?.trim().slice(0, 5000) ?? null,
        category: input.category ?? null,
        thumbnail_url: input.thumbnailUrl ?? null,
        duration_sec: input.durationSec ?? null,
        visibility: input.visibility ?? "public",
      })
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") {
        return { ok: false, error: "You've already published this link.", code: "duplicate" };
      }
      return { ok: false, error: "Couldn't publish.", code: "error" };
    }
    const id = data.id as string;

    // Store image dimensions as a SEPARATE best-effort update so a not-yet-applied
    // migration 0028 can never block publishing (unknown-column errors are ignored).
    if (input.mediaWidth && input.mediaHeight) {
      try {
        await db.from("posts").update({ media_width: input.mediaWidth, media_height: input.mediaHeight }).eq("id", id);
      } catch {
        /* columns not migrated yet — dimensions are optional */
      }
    }
    return { ok: true, id };
  } catch {
    return { ok: false, error: "Couldn't publish.", code: "error" };
  }
}

/* ---------------------------------- reads ------------------------------- */

interface PostRow {
  id: string;
  publisher_id: string;
  source_url: string;
  platform: string;
  source_author: string | null;
  media_kind: MediaKind;
  title: string;
  description: string | null;
  category: string | null;
  thumbnail_url: string | null;
  media_url: string | null;
  stream_uid: string | null;
  duration_sec: number | null;
  visibility: Visibility;
  status: string;
  views_count: number;
  likes_count: number;
  saves_count: number;
  shares_count: number;
  comments_count: number;
  downloads_count: number;
  created_at: string;
}

const POST_SELECT =
  "id, publisher_id, source_url, platform, source_author, media_kind, title, description, category, thumbnail_url, media_url, stream_uid, duration_sec, visibility, status, views_count, likes_count, saves_count, shares_count, comments_count, downloads_count, created_at";

export interface PostPublisher {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  isVerified: boolean;
  isFollowing: boolean;
}

export interface PublicPost extends PostRow {
  publisher: PostPublisher;
  isOwner: boolean;
  indexable: boolean;
}

/** Can `viewerId` see a post of this `visibility` by `publisherId`? */
async function canSeePost(
  db: ReturnType<typeof createAdminClient>,
  post: { publisher_id: string; visibility: Visibility; status: string },
  viewerId: string | null,
): Promise<boolean> {
  if (post.status !== "published") return viewerId === post.publisher_id;
  if (viewerId === post.publisher_id) return true;
  // Blocked either way → hidden.
  if (viewerId) {
    const { count } = await db
      .from("blocks")
      .select("blocker_id", { head: true, count: "exact" })
      .or(
        `and(blocker_id.eq.${post.publisher_id},blocked_id.eq.${viewerId}),and(blocker_id.eq.${viewerId},blocked_id.eq.${post.publisher_id})`,
      );
    if ((count ?? 0) > 0) return false;
  }
  if (post.visibility === "public") return true;
  if (!viewerId || post.visibility === "private") return false;
  const { count } = await db
    .from("follows")
    .select("follower_id", { head: true, count: "exact" })
    .eq("follower_id", viewerId)
    .eq("following_id", post.publisher_id);
  return (count ?? 0) > 0;
}

/** A single post with privacy applied + publisher card. Null = hidden/not found.
 *  `viewerIsAdmin` bypasses visibility so admins can review reported content. */
/** One ordered album item (mirrors FeedItem["mediaItems"] entries). */
export interface PostMediaItem {
  url: string;
  kind: "image" | "video";
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
}

/**
 * Ordered album items for a multi-media post. Returns [] for single-media
 * posts AND before migration 0032 exists (42P01-tolerant) — callers treat
 * "fewer than 2" as "not an album" and render the classic single hero.
 */
export async function getPostMediaItems(postId: string): Promise<PostMediaItem[]> {
  if (!hasSupabase) return [];
  try {
    const { data, error } = await createAdminClient()
      .from("post_media")
      .select("idx, media_kind, media_url, thumbnail_url, media_width, media_height")
      .eq("post_id", postId)
      .order("idx", { ascending: true });
    if (error || !data) return [];
    return (data as { media_kind: string; media_url: string; thumbnail_url: string | null; media_width: number | null; media_height: number | null }[]).map((r) => ({
      url: r.media_url,
      kind: r.media_kind === "video" ? ("video" as const) : ("image" as const),
      thumbnailUrl: r.thumbnail_url,
      width: r.media_width,
      height: r.media_height,
    }));
  } catch {
    return [];
  }
}

export async function getPost(
  id: string,
  viewerId: string | null,
  viewerIsAdmin = false,
): Promise<PublicPost | null> {
  if (!hasSupabase) return null;
  try {
    const db = createAdminClient();
    const { data } = await db.from("posts").select(POST_SELECT).eq("id", id).maybeSingle();
    const post = data as PostRow | null;
    if (!post) return null;
    if (!viewerIsAdmin && !(await canSeePost(db, post, viewerId))) return null;

    const { data: prof } = await db
      .from("profiles")
      .select("id, handle, display_name, avatar_url, is_verified, is_suspended")
      .eq("id", post.publisher_id)
      .maybeSingle();
    if (!prof || !prof.handle || (prof.is_suspended && !viewerIsAdmin)) return null;

    let isFollowing = false;
    if (viewerId && viewerId !== post.publisher_id) {
      const { count } = await db
        .from("follows")
        .select("follower_id", { head: true, count: "exact" })
        .eq("follower_id", viewerId)
        .eq("following_id", post.publisher_id);
      isFollowing = (count ?? 0) > 0;
    }

    return {
      ...post,
      publisher: {
        id: prof.id as string,
        handle: prof.handle as string,
        displayName: (prof.display_name as string) || `@${prof.handle}`,
        avatarUrl: prof.avatar_url as string | null,
        isVerified: prof.is_verified as boolean,
        isFollowing,
      },
      isOwner: viewerId === post.publisher_id,
      indexable: post.visibility === "public" && post.status === "published",
    };
  } catch {
    return null;
  }
}

export interface PostCard {
  id: string;
  title: string;
  platform: string;
  mediaKind: MediaKind;
  thumbnailUrl: string | null;
  /** Media file (upload) — lets grids draw a real first frame when there's no cover. */
  mediaUrl: string | null;
  category: string | null;
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  createdAt: string;
  /** Number of album items (>1 means multi-media post — grids show a badge). */
  albumCount?: number;
  /** Present only on the profile Reposts tab — the reposter's own layer. */
  repost?: { caption: string | null; pinned: boolean; edited: boolean };
}

function toCard(p: PostRow): PostCard {
  return {
    id: p.id,
    title: p.title,
    platform: p.platform,
    mediaKind: p.media_kind,
    thumbnailUrl: p.thumbnail_url,
    mediaUrl: p.media_url,
    category: p.category,
    viewsCount: p.views_count,
    likesCount: p.likes_count,
    commentsCount: p.comments_count,
    createdAt: p.created_at,
  };
}

/** A creator's published posts, filtered to what `viewerId` may see.
 *  Cached 30s per (creator, viewer) via Upstash — repeat profile views are served
 *  from the cache, not re-queried, which sharply cuts Supabase egress. Failures
 *  are never cached (the loader throws) so a blip can't stick an empty profile. */
export async function listUserPosts(
  publisherId: string,
  viewerId: string | null,
  limit = 24,
): Promise<PostCard[]> {
  if (!hasSupabase) return [];
  try {
    return await getCached(`userposts:${publisherId}:${viewerId ?? "anon"}:${limit}`, 30, () =>
      loadUserPosts(publisherId, viewerId, limit),
    );
  } catch {
    return [];
  }
}

async function loadUserPosts(publisherId: string, viewerId: string | null, limit: number): Promise<PostCard[]> {
  const db = createAdminClient();
  const isOwner = viewerId === publisherId;
  let q = db
    .from("posts")
    .select(POST_SELECT)
    .eq("publisher_id", publisherId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (!isOwner) q = q.eq("status", "published");
  const { data, error } = await q;
  if (error) throw error; // don't cache DB failures as "no posts"
  let rows = (data as PostRow[]) ?? [];
  if (!isOwner) {
    // Drop followers-only/private unless the viewer follows (one check).
    let follows = false;
    if (viewerId) {
      const { count } = await db
        .from("follows")
        .select("follower_id", { head: true, count: "exact" })
        .eq("follower_id", viewerId)
        .eq("following_id", publisherId);
      follows = (count ?? 0) > 0;
    }
    rows = rows.filter(
      (p) => p.visibility === "public" || (p.visibility === "followers" && follows),
    );
  }
  const cards = rows.map(toCard);
  // Album badge data — one query for the whole page of posts; best-effort
  // (pre-migration-0032 the table doesn't exist and grids simply show no badge).
  try {
    const ids = cards.map((c) => c.id);
    if (ids.length > 0) {
      const { data: media } = await db.from("post_media").select("post_id").in("post_id", ids);
      if (media) {
        const counts = new Map<string, number>();
        for (const m of media as { post_id: string }[]) {
          counts.set(m.post_id, (counts.get(m.post_id) ?? 0) + 1);
        }
        for (const c of cards) {
          const n = counts.get(c.id) ?? 0;
          if (n > 1) c.albumCount = n;
        }
      }
    }
  } catch {
    /* table missing — no badges */
  }
  return cards;
}

/** The user's saved posts (still-published, visible to them), newest save first. */
export async function listSavedPosts(userId: string, limit = 24): Promise<PostCard[]> {
  if (!hasSupabase) return [];
  try {
    const db = createAdminClient();
    const { data: saves } = await db
      .from("post_reactions")
      .select("post_id, created_at")
      .eq("user_id", userId)
      .eq("type", "save")
      .order("created_at", { ascending: false })
      .limit(limit * 2);
    const ids = ((saves ?? []) as { post_id: string }[]).map((r) => r.post_id);
    if (ids.length === 0) return [];

    const { data } = await db.from("posts").select(POST_SELECT).in("id", ids).eq("status", "published");
    const rows = ((data as PostRow[]) ?? []).filter(
      (p) => p.visibility === "public" || p.publisher_id === userId,
    );
    // Preserve save recency.
    const order = new Map(ids.map((id, i) => [id, i]));
    rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    return rows.slice(0, limit).map(toCard);
  } catch {
    return [];
  }
}

/** The user's liked posts (still-published, visible), newest like first. */
export async function listLikedPosts(userId: string, limit = 24): Promise<PostCard[]> {
  if (!hasSupabase) return [];
  try {
    const db = createAdminClient();
    const { data: likes } = await db
      .from("post_reactions")
      .select("post_id, created_at")
      .eq("user_id", userId)
      .eq("type", "like")
      .order("created_at", { ascending: false })
      .limit(limit * 2);
    const ids = ((likes ?? []) as { post_id: string }[]).map((r) => r.post_id);
    if (ids.length === 0) return [];

    const { data } = await db.from("posts").select(POST_SELECT).in("id", ids).eq("status", "published");
    const rows = ((data as PostRow[]) ?? []).filter(
      (p) => p.visibility === "public" || p.publisher_id === userId,
    );
    const order = new Map(ids.map((id, i) => [id, i]));
    rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    return rows.slice(0, limit).map(toCard);
  } catch {
    return [];
  }
}

/** The user's reposted posts (original cards, attribution preserved), newest
 *  repost first. Best-effort — returns [] before the reposts table is migrated. */
export async function listUserReposts(userId: string, limit = 24): Promise<PostCard[]> {
  if (!hasSupabase) return [];
  try {
    const db = createAdminClient();
    type RepostRow = { post_id: string; caption?: string | null; pinned_at?: string | null; edited_at?: string | null };
    // Pinned reposts lead the tab. Caption/pin columns arrive with migration
    // 0030 — fall back to the plain shape until it's applied.
    let rows: RepostRow[];
    const rich = await db
      .from("reposts")
      .select("post_id, caption, pinned_at, edited_at")
      .eq("user_id", userId)
      .order("pinned_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(limit * 2);
    if (rich.error) {
      const { data } = await db
        .from("reposts")
        .select("post_id, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit * 2);
      rows = ((data ?? []) as { post_id: string }[]).map((r) => ({ post_id: r.post_id }));
    } else {
      rows = (rich.data ?? []) as unknown as RepostRow[];
    }
    const ids = rows.map((r) => r.post_id);
    if (ids.length === 0) return [];
    const metaById = new Map(rows.map((r) => [r.post_id, r]));

    const { data } = await db.from("posts").select(POST_SELECT).in("id", ids).eq("status", "published");
    const posts = ((data as PostRow[]) ?? []).filter((p) => p.visibility === "public");
    const order = new Map(ids.map((id, i) => [id, i]));
    posts.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    return posts.slice(0, limit).map((p) => {
      const meta = metaById.get(p.id);
      return {
        ...toCard(p),
        repost: { caption: meta?.caption ?? null, pinned: !!meta?.pinned_at, edited: !!meta?.edited_at },
      };
    });
  } catch {
    return [];
  }
}

/** Posts in a collection the viewer may see, newest-added first. Visibility of
 *  the collection itself is checked by the caller; here we filter the POSTS to
 *  what the viewer can see (public, own, or followers-only if they follow). */
export async function listCollectionPosts(
  collectionId: string,
  viewerId: string | null,
  limit = 48,
): Promise<PostCard[]> {
  if (!hasSupabase) return [];
  try {
    const db = createAdminClient();
    const { data: items } = await db
      .from("collection_items")
      .select("post_id, added_at")
      .eq("collection_id", collectionId)
      .order("added_at", { ascending: false })
      .limit(limit * 2);
    const ids = ((items ?? []) as { post_id: string }[]).map((r) => r.post_id);
    if (ids.length === 0) return [];

    const { data } = await db.from("posts").select(POST_SELECT).in("id", ids).eq("status", "published");
    let rows = (data as PostRow[]) ?? [];
    // Followers-only posts show only to the publisher or a follower.
    let follows = new Set<string>();
    if (viewerId) {
      const publisherIds = [...new Set(rows.map((p) => p.publisher_id))];
      const { data: f } = await db
        .from("follows")
        .select("following_id")
        .eq("follower_id", viewerId)
        .in("following_id", publisherIds);
      follows = new Set(((f ?? []) as { following_id: string }[]).map((x) => x.following_id));
    }
    rows = rows.filter(
      (p) =>
        p.visibility === "public" ||
        p.publisher_id === viewerId ||
        (p.visibility === "followers" && follows.has(p.publisher_id)),
    );
    const order = new Map(ids.map((id, i) => [id, i]));
    rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    return rows.slice(0, limit).map(toCard);
  } catch {
    return [];
  }
}

/** Related posts (same category, then same publisher), excluding the current. */
export async function relatedPosts(post: PublicPost, limit = 6): Promise<PostCard[]> {
  if (!hasSupabase) return [];
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("posts")
      .select(POST_SELECT)
      .eq("status", "published")
      .eq("visibility", "public")
      .neq("id", post.id)
      .eq(post.category ? "category" : "platform", post.category ?? post.platform)
      .order("hot_score", { ascending: false })
      .limit(limit);
    return ((data as PostRow[]) ?? []).map(toCard);
  } catch {
    return [];
  }
}

/** Records a deduped view (per viewer|ip per day). Fire-and-forget friendly. */
export async function recordPostView(
  postId: string,
  viewerId: string | null,
  ipHash: string,
): Promise<void> {
  if (!hasSupabase) return;
  try {
    const db = createAdminClient();
    // Unique index makes a repeat view a no-op (the trigger only bumps on insert).
    await db.from("post_views").insert({
      post_id: postId,
      viewer_id: viewerId,
      ip_hash: viewerId ? "" : ipHash,
    });
  } catch {
    /* duplicate view or transient error — ignore */
  }
}
