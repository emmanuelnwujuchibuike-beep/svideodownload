import { getSyncConditions } from "@/lib/media/network-conditions";

const prefetched = new Set<string>();

/**
 * Warms the browser's own HTTP cache for a RAW (non-next/image-optimized)
 * image URL — the exact resource the fullscreen image/reel/album viewers
 * request via a plain `<img src>`. The feed's inline thumbnail only ever
 * fetches next/image's resized variant (a completely different URL:
 * `/_next/image?url=<encoded>&w=...&q=...`), so no amount of thumbnail
 * caching ever helps the viewer — confirmed the root cause of "still delays
 * to open" before writing this. Called as a feed card/carousel slide
 * approaches the viewport (well before it's actually tapped), so by the time
 * a viewer opens, the browser already has the bytes and the `<img>` there is
 * an instant cache hit instead of a fresh network fetch.
 *
 * Deduped (never re-fetches the same URL twice this session) and skipped
 * entirely on Data Saver / a slow connection — same gate `warmMediaCache`
 * already uses for the Continue Watching cache-warm, so this never costs a
 * constrained viewer anything.
 */
export function prefetchImage(url: string | null | undefined): void {
  if (!url || typeof window === "undefined" || prefetched.has(url)) return;
  const { saveData, effectiveType } = getSyncConditions();
  if (saveData || effectiveType === "slow-2g" || effectiveType === "2g") return;
  prefetched.add(url);
  const img = new Image();
  img.src = url;
}
