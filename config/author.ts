/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE AUTHOR OF THE BLOG POSTS AND /learn GUIDES — fill this in (owner)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * One record, used in two places on every blog post and every /learn guide:
 *   · the visible byline under the title (components/seo/author-byline.tsx);
 *   · the Article JSON-LD `author` (lib/seo/article-ld.ts).
 *
 * 🔴 The values below are PLACEHOLDERS (2026-10-29). Replace each bracketed value with the real person before the
 * site is deployed or submitted for review — a byline reading "[Author name]" is worse than none.
 *
 *   name    — the real name readers and Google will see.
 *   bio     — one or two sentences: who writes these guides and why they know the subject.
 *   avatar  — a square photo in /public (for example "/authors/your-name.jpg", at least 96×96). Leave "" to show the
 *             initials instead.
 *   url     — optional: a page about the author (an /about anchor, or a professional profile). "" to omit.
 */
export interface SiteAuthor {
  name: string;
  bio: string;
  avatar: string;
  url: string;
}

export const SITE_AUTHOR: SiteAuthor = {
  name: "[Author name]",
  bio: "[Short bio — one or two sentences about who writes these guides and why they know the subject.]",
  avatar: "",
  url: "",
};

/** True while any field still holds its bracketed placeholder — surfaced by the byline so it is not missed. */
export function authorIsPlaceholder(author: SiteAuthor = SITE_AUTHOR): boolean {
  return /^\[.*\]$/.test(author.name.trim()) || /^\[.*\]$/.test(author.bio.trim());
}
