/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE AUTHOR OF THE BLOG POSTS AND /learn GUIDES — fill this in (owner)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * One record, used in two places on every blog post and every /learn guide:
 *   · the visible byline under the title (components/seo/author-byline.tsx);
 *   · the Article JSON-LD `author` (lib/seo/article-ld.ts).
 *
 * The author is Michael Phillip (owner, 2026-10-29). Add an avatar file and a profile link below whenever ready.
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
  // the guide author (owner, 2026-10-29)
  name: "Michael Phillip",
  // a role, not invented credentials — replace with a fuller bio whenever you like
  bio: "Writes Frenzsave's guides to saving, organising and archiving your own videos.",
  avatar: "",
  url: "",
};

/** True while any field still holds its bracketed placeholder — surfaced by the byline so it is not missed. */
export function authorIsPlaceholder(author: SiteAuthor = SITE_AUTHOR): boolean {
  return /^\[.*\]$/.test(author.name.trim()) || /^\[.*\]$/.test(author.bio.trim());
}
