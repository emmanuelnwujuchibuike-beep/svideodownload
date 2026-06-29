import { createHash } from "node:crypto";

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
    return `${u.protocol}//${u.host}${u.pathname}${u.search}`.replace(/\/$/, "").toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
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
        title: input.title.trim().slice(0, 140),
        description: input.description?.trim().slice(0, 1000) ?? null,
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
    return { ok: true, id: data.id as string };
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
  "id, publisher_id, source_url, platform, source_author, media_kind, title, description, category, thumbnail_url, duration_sec, visibility, status, views_count, likes_count, saves_count, shares_count, comments_count, downloads_count, created_at";

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

/** A single post with privacy applied + publisher card. Null = hidden/not found. */
export async function getPost(id: string, viewerId: string | null): Promise<PublicPost | null> {
  if (!hasSupabase) return null;
  try {
    const db = createAdminClient();
    const { data } = await db.from("posts").select(POST_SELECT).eq("id", id).maybeSingle();
    const post = data as PostRow | null;
    if (!post) return null;
    if (!(await canSeePost(db, post, viewerId))) return null;

    const { data: prof } = await db
      .from("profiles")
      .select("id, handle, display_name, avatar_url, is_verified, is_suspended")
      .eq("id", post.publisher_id)
      .maybeSingle();
    if (!prof || prof.is_suspended || !prof.handle) return null;

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
  category: string | null;
  viewsCount: number;
  createdAt: string;
}

function toCard(p: PostRow): PostCard {
  return {
    id: p.id,
    title: p.title,
    platform: p.platform,
    mediaKind: p.media_kind,
    thumbnailUrl: p.thumbnail_url,
    category: p.category,
    viewsCount: p.views_count,
    createdAt: p.created_at,
  };
}

/** A creator's published posts, filtered to what `viewerId` may see. */
export async function listUserPosts(
  publisherId: string,
  viewerId: string | null,
  limit = 24,
): Promise<PostCard[]> {
  if (!hasSupabase) return [];
  try {
    const db = createAdminClient();
    const isOwner = viewerId === publisherId;
    let q = db
      .from("posts")
      .select(POST_SELECT)
      .eq("publisher_id", publisherId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (!isOwner) q = q.eq("status", "published");
    const { data } = await q;
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
    return rows.map(toCard);
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
