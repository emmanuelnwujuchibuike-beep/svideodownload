import { isCategory } from "./categories";

/**
 * Builds a URL-safe, human-readable slug from a title, suffixed with a short
 * fragment of the post's own id. The suffix makes every slug collision-free
 * BY CONSTRUCTION — two posts can share the same title and never collide —
 * so publishing never needs a DB round-trip to check uniqueness or retry on
 * a conflict. Mirrors `slugifyFilename` in lib/utils.ts (same normalize/strip/
 * hyphenate shape) minus the file extension, since this is a URL segment.
 */
export function slugifyTitle(title: string, id: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60)
    .toLowerCase()
    .replace(/^-+|-+$/g, "");
  const suffix = id.replace(/-/g, "").slice(0, 8);
  return base ? `${base}-${suffix}` : suffix;
}

/** The minimal shape `postHref` needs — satisfied by both `PostCard` and `FeedItem`. */
export interface PostLinkable {
  id: string;
  slug?: string | null;
  category?: string | null;
  createdAt?: string;
  created_at?: string;
}

/**
 * The single source of truth for "what is this post's canonical URL" — used
 * by the feed, PostGrid, share/copy-link, the sitemaps, and the /p/[id]
 * redirect. A categorized post with a slug gets the descriptive SEO path;
 * everything else (no slug yet, no category, migration 0126 not applied)
 * falls back to the permanent /p/[id] — never a broken or duplicate link.
 */
export function postHref(post: PostLinkable): string {
  const createdAt = post.createdAt ?? post.created_at;
  if (post.slug && post.category && isCategory(post.category) && createdAt) {
    const d = new Date(createdAt);
    if (!Number.isNaN(d.getTime())) {
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
      return `/${post.category}/${yyyy}/${mm}/${post.slug}`;
    }
  }
  return `/p/${post.id}`;
}

/** A post opened in the Reels viewer, starting on it (app/(app)/reels/page.tsx `?start=`). */
export function reelsViewHref(id: string): string {
  return `/reels?start=${encodeURIComponent(id)}`;
}

/**
 * Where tapping a post goes (owner, 2026-10-17: "all route of view should open in reels
 * viewer"): a VIDEO opens in the Reels viewer; a photo or text post keeps its post page.
 * The post pages redirect a video the same way, so an old or shared link lands there too.
 */
export function postViewHref(post: PostLinkable & { mediaKind?: string | null; media_kind?: string | null }): string {
  return (post.mediaKind ?? post.media_kind) === "video" ? reelsViewHref(post.id) : postHref(post);
}
