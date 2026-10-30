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
  const images = post.thumbnail_url ? [{ url: post.thumbnail_url }] : undefined;
  /*
    A shared post previews as the CONTENT (owner, 2026-10-30: like TikTok, Instagram and Facebook, "the content shows
    only the image and not the profile preview unless it was the Profile link"): its own picture, large, and its own
    caption. The Twitter card is set here explicitly — left out, Next keeps the ROOT layout's twitter title ("Frenzsave
    — Download, Earn…"), so X showed the site's headline on every post instead of the post. og:url is the post's own
    address, so a preview never points somewhere else.
  */
  return {
    title,
    description: post.description ?? `Watch & save from ${post.platform} on FrenzSave.`,
    alternates: { canonical: canonicalPath },
    robots: { index: post.indexable, follow: post.indexable },
    openGraph: {
      type: "video.other",
      url: canonicalPath,
      title,
      description: post.description ?? undefined,
      images,
    },
    twitter: {
      card: "summary_large_image",
      title,
      ...(post.description ? { description: post.description } : {}),
      ...(images ? { images } : {}),
    },
  };
}
