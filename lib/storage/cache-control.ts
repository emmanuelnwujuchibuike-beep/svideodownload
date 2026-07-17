/**
 * The one Cache-Control value for uploaded media, shared by every upload path.
 *
 * Safe to cache forever because every upload key is UNIQUE (`${id}-${random}.ext`)
 * — the bytes behind a media URL never change, so there is nothing to invalidate.
 * Editing media produces a new key and therefore a new URL.
 *
 * Why this exists as a constant rather than a literal at each call site: it was
 * set on the SERVER upload path (`putR2`) and silently missing from the BROWSER
 * upload path — which is the path nearly all media actually takes (chat
 * attachments, stories, posts). Probed live 2026-07-16 against a real 1.4MB chat
 * video on media.frenzsave.com:
 *
 *     Content-Type: video/mp4
 *     Cf-Cache-Status: DYNAMIC        <- Cloudflare NOT caching
 *     (no Cache-Control, no Last-Modified, no Expires)
 *
 * With no Cache-Control AND no Last-Modified, a browser has nothing to compute
 * heuristic freshness from, so it re-requests the object on every mount. That is
 * the real cause of "the video sent in chat reloads each time someone enters the
 * chat" — and, because the CDN wasn't caching either, every one of those views
 * billed R2 egress at the origin.
 */

/** One year, the max any HTTP cache should be asked to hold something. */
export const MEDIA_MAX_AGE_SECONDS = 31536000;

export const MEDIA_CACHE_CONTROL = `public, max-age=${MEDIA_MAX_AGE_SECONDS}, immutable`;
