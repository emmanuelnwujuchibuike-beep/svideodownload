import type { PlatformId } from "@/types";

/**
 * The canonical downloader page per platform — slug and platform id ONLY.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  🔴 WHY THIS DUPLICATES SOMETHING `seo-pages.ts` ALREADY KNOWS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `site-header.tsx` and `downloader-links.tsx` are CLIENT components, and they
 * were importing `getPrimaryPages()` from `lib/seo/seo-pages.ts`. A bundler
 * takes the whole MODULE, not the export you named — a law this codebase has
 * already been bitten by twice — so that import dragged the entire SEO content
 * graph into every client bundle, the landing page included.
 *
 * Measured 2026-09-02: adding the hand-written per-platform content
 * (`platform-content.ts`, the AdSense fix) pushed the landing's cold-entry
 * bundle from 217,102 B to 228,974 B against a 223,232 B ceiling — 5,742 B
 * over, on the one route held to the owner's 1.6-second rule. The offending
 * chunk contained the FAQ prose verbatim, shipped to a page that never renders
 * a word of it.
 *
 * Both components use exactly two fields, so this is that pair and nothing
 * else: no titles, no descriptions, no FAQs, no imports beyond a type. The
 * whole file costs a few hundred bytes.
 *
 * 🔴 IT CANNOT SILENTLY DRIFT. `primary-links.test.ts` asserts this list is
 * exactly what `getPrimaryPages()` produces, in the same order — so adding,
 * removing or reordering a cluster fails the build here until this is updated.
 * A hand-maintained copy without that guard would be a bug waiting for the next
 * platform.
 */
export interface PrimaryLink {
  slug: string;
  platformId: PlatformId;
}

export const PRIMARY_LINKS: readonly PrimaryLink[] = [
  { slug: "tiktok-video-downloader", platformId: "tiktok" },
  { slug: "instagram-reels-downloader", platformId: "instagram" },
  { slug: "twitter-video-downloader", platformId: "twitter" },
  { slug: "facebook-video-downloader", platformId: "facebook" },
  { slug: "pinterest-video-downloader", platformId: "pinterest" },
  { slug: "snapchat-story-downloader", platformId: "snapchat" },
  { slug: "reddit-video-downloader", platformId: "reddit" },
  { slug: "vimeo-video-downloader", platformId: "vimeo" },
  { slug: "linkedin-video-downloader", platformId: "linkedin" },
  { slug: "threads-video-downloader", platformId: "threads" },
  { slug: "telegram-video-downloader", platformId: "telegram" },
];
