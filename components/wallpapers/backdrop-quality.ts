/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  🔴 THE LANDING PAGE'S LCP, IN ONE NUMBER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Measured on PRODUCTION 2026-09-01, Pixel 7, slow-4G. The wallpaper CTA's
 * backdrop IS the landing page's LCP element, and it was arriving as
 * **186,646 bytes**:
 *
 *     936ms -> 4156ms   (3220ms)   182.6 kB   /_next/image?...&w=640&q=75
 *
 * LCP landed at 4228ms — 72ms after that response ended. The image was not
 * merely correlated with LCP; it WAS LCP. It was a quarter of everything on the
 * wire, queued ahead of 30 scripts on a 1.6 Mbps link.
 *
 * ── Why an explicit quality, when 75 is next/image's default ─────────────────
 *
 * Because the default is exactly the problem. Probing the live optimizer — same
 * URL, same `Accept: image/avif,image/webp,...` header:
 *
 *     w=640 q=74  ->   89,146 B   image/avif
 *     w=640 q=76  ->   89,146 B   image/avif
 *     w=640 q=75  ->  186,646 B   image/WEBP     <- what every visitor got
 *
 * q=75 alone answers WebP. It is a **poisoned cache entry**: that variant was
 * generated and cached before `formats: ["image/avif", "image/webp"]` was set
 * in next.config.ts, and it is now pinned behind `max-age=31536000` at both
 * Vercel and Cloudflare (`x-vercel-cache: HIT`, `cf-cache-status: HIT`).
 * Re-requesting it with an AVIF-capable Accept does not dislodge it, and it
 * cannot be purged from application code. Naming any other quality mints a
 * fresh cache key and escapes it.
 *
 * ⚠️ THIS IS NOT LOCAL TO THE WALLPAPER TILE. Any image on the site still on
 * the default quality whose q=75 variant was cached before that config change
 * is serving the same oversized WebP. This fixes the one on the critical path;
 * the general sweep is open work.
 *
 * ── Why 50 and not 74 ───────────────────────────────────────────────────────
 *
 *     q=60  ->  56,061 B      q=50  ->  42,087 B      q=40  ->  31,456 B
 *
 * This is a photographic backdrop rendered at ~206x190 CSS px underneath a
 * gradient scrim, a heading, a sub-line and an arrow. At `w=640` into a 206px
 * slot it is oversampled ~3x even for DPR, so q=50 AVIF carries far more
 * information per DISPLAYED pixel than a q=75 JPEG would at 1x.
 *
 * 186.6 kB -> 42.1 kB is **-144.5 kB, a 77% cut, on the one resource that
 * defines LCP** — and it frees that bandwidth for the 30 scripts behind it.
 *
 * ── Why a module of its own ─────────────────────────────────────────────────
 *
 * Two components draw this tile: `WallpaperBackdrop` (server) and
 * `RotatingWallpaperLayers` ("use client"), whose first frame must stay
 * byte-identical to the static one or the rotating caller silently keeps the
 * slow variant on the LCP path. They cannot import it from each other without
 * a cycle — and a client component importing a server module drags that
 * module's whole dependency chain into the browser bundle, which this project
 * has already been bitten by once. A bare constant file is importable from
 * both sides at zero cost.
 */
export const BACKDROP_QUALITY = 50;
