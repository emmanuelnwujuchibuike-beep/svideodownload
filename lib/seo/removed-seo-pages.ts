/**
 * The 70 generated downloader pages MERGED AWAY on 2026-08-23 (see the removal
 * note in config/seoPages.ts), and where each one now redirects to.
 *
 * ── Why this list is hand-kept rather than diffed at build time ──────────────
 * `config/seoPages.ts` no longer contains these slugs at all — that is the
 * fix. So there is nothing left in the live config to derive "what used to
 * exist" from; the only record of it is this file, written once from the
 * removal itself. If a FUTURE cluster ever legitimately wants a
 * `-mp4-downloader` (etc.) slug back, remove its entry here first, or the
 * redirect below would shadow the new page.
 *
 * ── Why redirect instead of letting them 404 ──────────────────────────────────
 * Every one of these was a real, indexed, sitemapped URL. A 404 tells Google
 * "this is gone," which drops whatever ranking signal it had earned; a
 * permanent redirect to the platform's actual primary page tells Google
 * "this moved," which consolidates that signal onto the page that now
 * answers the same query with real content instead of a template.
 */
export interface RemovedSeoPage {
  /** The removed page's full slug, e.g. "tiktok-mp4-downloader". */
  from: string;
  /** The cluster's primary page it now redirects to, e.g. "tiktok-video-downloader". */
  to: string;
}

const MERGED_MODIFIER_SLUGS = [
  "mp4-downloader",
  "online-downloader",
  "free-downloader",
  "fast-downloader",
  "video-saver",
  "downloader-without-app",
] as const;

/**
 * Cluster stem → primary page slug, and which of the six merged modifiers
 * that cluster actually had (mirrors GENERIC_BY_CLUSTER in
 * config/seoPages.ts at the moment of removal — youtube never had
 * `mp4-downloader` because it had its own inline "youtube-to-mp4" page, and
 * snapchat never had `fast-downloader` at all).
 */
const CLUSTERS: { stem: string; primary: string; had: readonly (typeof MERGED_MODIFIER_SLUGS)[number][] }[] = [
  { stem: "tiktok", primary: "tiktok-video-downloader", had: MERGED_MODIFIER_SLUGS },
  { stem: "instagram", primary: "instagram-reels-downloader", had: MERGED_MODIFIER_SLUGS },
  {
    stem: "youtube",
    primary: "youtube-shorts-downloader",
    had: ["online-downloader", "free-downloader", "fast-downloader", "video-saver", "downloader-without-app"],
  },
  { stem: "twitter", primary: "twitter-video-downloader", had: MERGED_MODIFIER_SLUGS },
  { stem: "facebook", primary: "facebook-video-downloader", had: MERGED_MODIFIER_SLUGS },
  { stem: "pinterest", primary: "pinterest-video-downloader", had: MERGED_MODIFIER_SLUGS },
  {
    stem: "snapchat",
    primary: "snapchat-story-downloader",
    had: ["mp4-downloader", "online-downloader", "free-downloader", "video-saver", "downloader-without-app"],
  },
  { stem: "reddit", primary: "reddit-video-downloader", had: MERGED_MODIFIER_SLUGS },
  { stem: "vimeo", primary: "vimeo-video-downloader", had: MERGED_MODIFIER_SLUGS },
  { stem: "linkedin", primary: "linkedin-video-downloader", had: MERGED_MODIFIER_SLUGS },
  { stem: "threads", primary: "threads-video-downloader", had: MERGED_MODIFIER_SLUGS },
  { stem: "telegram", primary: "telegram-video-downloader", had: MERGED_MODIFIER_SLUGS },
];

export const REMOVED_SEO_PAGES: RemovedSeoPage[] = CLUSTERS.flatMap(({ stem, primary, had }) =>
  had.map((modifierSlug) => ({ from: `${stem}-${modifierSlug}`, to: primary })),
);
