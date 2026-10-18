import type { Metadata } from "next";

import { titleFromCaption } from "@/lib/social/caption";
import type { PublicPost } from "@/lib/social/posts";

/**
 * Metadata for a resolved post, keyed to wherever it's actually mounted.
 * `canonicalPath` is the caller's decision, not this file's — app/p/[id]
 * passes `/p/${id}` (or redirects before ever calling this, once a slug
 * exists), the SEO slug route passes its own `postHref(post)` path — so
 * this single builder never has to know which route it's being called from.
 *
 * Its own module (2026-10-17) so the Reels page can build a video post's share
 * preview without importing the post page's client components.
 */
export function postPageMetadata(post: PublicPost, canonicalPath: string): Metadata {
  /*
    🔴 THE CAPTION IS NOT THE TITLE TAG (2026-08-23). `posts.title` holds the
    caption verbatim, and the caption limit moved from 300 characters to 250
    words — so passing it through raw would emit `<title>` elements over a
    thousand characters long. `titleFromCaption` takes the first sentence or a
    word-boundary trim; the full caption is still rendered on the page itself
    and still carried in the description/OG description below, so nothing is
    hidden from a reader or a crawler, it is just no longer crammed into the
    one element that must stay short.
  */
  const title = titleFromCaption(post.title) || post.title;
  return {
    title,
    description: post.description ?? `Watch & save from ${post.platform} on FrenzSave.`,
    alternates: { canonical: canonicalPath },
    robots: { index: post.indexable, follow: post.indexable },
    openGraph: {
      type: "video.other",
      title,
      description: post.description ?? undefined,
      images: post.thumbnail_url ? [{ url: post.thumbnail_url }] : undefined,
    },
  };
}
