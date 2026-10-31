/**
 * Edge caching for the cold-entry pages (owner, 2026-10-31: the landing and Download page "should be below 1.6").
 *
 * Measured that day: the landing and the downloader pages are prerendered (x-vercel-cache: PRERENDER), yet every visit
 * waited 0.55–0.85 s for its first byte, because they leave Vercel with `Cache-Control: public, max-age=0,
 * must-revalidate` and Cloudflare therefore REVALIDATED with Vercel on every request (cf-cache-status: REVALIDATED).
 * The same build served locally paints in ~0.7 s (landing) / ~1.0 s (downloader). This header is read by Cloudflare
 * ONLY (browsers ignore it and keep the page's own Cache-Control): Cloudflare answers from its copy for 5 minutes,
 * then serves that copy while it refreshes in the background for up to a day. Old HTML after a deploy still works —
 * its chunk URLs carry `?dpl=` (Vercel skew protection).
 *
 * 🔴 `/` IS ALSO A MEMBER REDIRECT: middleware sends a signed-in visitor's `/` to /downloads. Cloudflare's cache key
 * ignores cookies, so the Cloudflare dashboard MUST carry a Cache Rule that BYPASSES the cache when the request's
 * cookie contains `-auth-token` before this ships — otherwise a member would be handed the guest landing. The
 * downloader pages have no member branch.
 *
 * No `@/` imports: next.config.ts loads this file.
 */
export const EDGE_CACHE_HEADER = { key: "Cloudflare-CDN-Cache-Control", value: "max-age=300, stale-while-revalidate=86400" } as const;

/** The landing and every downloader page (`<platform>-<video|reels|story>-downloader`, lib/seo/seo-pages.ts). */
export const EDGE_CACHED_SOURCES = ["/", "/:page([a-z0-9-]+-downloader)"] as const;
