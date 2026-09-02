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

/**
 * Round 2 (2026-08-25): the entire `youtube` CLUSTER was removed from
 * config/seoPages.ts — not just its merged modifiers like round 1 above, all
 * five of its pages. AdSense rejected the site as "low value content" twice;
 * the owner's read is that a YouTube-branded downloader specifically is the
 * trigger (YouTube's own ToS/AdSense's own policy are unusually strict about
 * third-party YouTube downloaders), so every youtube-* page redirects to
 * LinkedIn's — the platform the owner is promoting in its place. These don't
 * fit the CLUSTERS/MERGED_MODIFIER_SLUGS shape above (that models six
 * specific merged modifiers a cluster KEPT other pages for; this is a whole
 * cluster gone), so they're listed directly instead of forcing the generator
 * to express a different kind of removal.
 */
const YOUTUBE_CLUSTER_REMOVED: RemovedSeoPage[] = [
  "youtube-shorts-downloader",
  "youtube-video-downloader",
  "youtube-to-mp3-converter",
  "youtube-thumbnail-downloader",
  "youtube-1080p-downloader",
].map((from) => ({ from, to: "linkedin-video-downloader" }));

/**
 * Round 3 (2026-09-02): the 32 DEVICE-VARIANT pages — `-downloader-for-iphone`,
 * `-for-android`, `-for-pc` — merged into their platform's primary page.
 *
 * ── Why these and not the others ─────────────────────────────────────────
 * `lib/seo/seo-pages.ts` already said it, in a note left for exactly this
 * decision: after round 1, within-platform duplication was measured at 92%, and
 * the device variants "remain the same tool with a device word swapped. That is
 * a page-count decision, not a copy decision."
 *
 * It is the right call. A downloader does not behave differently on an iPhone
 * than on a PC — it is the same paste box, the same extraction, the same file.
 * The only honest per-device content is a short "how saving works on iOS vs
 * Android" section, and that belongs ON the platform page (where it now lives)
 * rather than being the entire justification for three more URLs.
 *
 * `hd-downloader` and `mp3-downloader` are deliberately KEPT: those are
 * different OUTPUTS a visitor is actually choosing between (a 1080p video file
 * versus an audio file), not the same output on a different screen.
 *
 * ── Snapchat has two, not three ─────────────────────────────────────────
 * Its generic set was already trimmed in round 1 to `[iphone, android]`. Listed
 * from the real config rather than assumed, because a redirect for a URL that
 * never existed is harmless but a missing one is a 404 on an indexed page.
 */
const DEVICE_VARIANT_SLUGS = ["downloader-for-iphone", "downloader-for-android", "downloader-for-pc"] as const;

const DEVICE_MERGED: { stem: string; primary: string; had: readonly string[] }[] = [
  { stem: "tiktok", primary: "tiktok-video-downloader", had: DEVICE_VARIANT_SLUGS },
  { stem: "instagram", primary: "instagram-reels-downloader", had: DEVICE_VARIANT_SLUGS },
  { stem: "twitter", primary: "twitter-video-downloader", had: DEVICE_VARIANT_SLUGS },
  { stem: "facebook", primary: "facebook-video-downloader", had: DEVICE_VARIANT_SLUGS },
  { stem: "pinterest", primary: "pinterest-video-downloader", had: DEVICE_VARIANT_SLUGS },
  // Round 1 left snapchat with only these two generics.
  { stem: "snapchat", primary: "snapchat-story-downloader", had: ["downloader-for-iphone", "downloader-for-android"] },
  { stem: "reddit", primary: "reddit-video-downloader", had: DEVICE_VARIANT_SLUGS },
  { stem: "vimeo", primary: "vimeo-video-downloader", had: DEVICE_VARIANT_SLUGS },
  { stem: "linkedin", primary: "linkedin-video-downloader", had: DEVICE_VARIANT_SLUGS },
  { stem: "threads", primary: "threads-video-downloader", had: DEVICE_VARIANT_SLUGS },
  { stem: "telegram", primary: "telegram-video-downloader", had: DEVICE_VARIANT_SLUGS },
];

export const REMOVED_SEO_PAGES: RemovedSeoPage[] = [
  ...CLUSTERS.flatMap(({ stem, primary, had }) => had.map((modifierSlug) => ({ from: `${stem}-${modifierSlug}`, to: primary }))),
  ...YOUTUBE_CLUSTER_REMOVED,
  ...DEVICE_MERGED.flatMap(({ stem, primary, had }) => had.map((modifierSlug) => ({ from: `${stem}-${modifierSlug}`, to: primary }))),
];
