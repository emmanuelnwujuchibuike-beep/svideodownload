/**
 * Ad IMAGES are served resized for the slot, never as uploaded (owner,
 * 2026-10-10: "after setting up the ad, landing and download LCP broke").
 *
 * A 1024 × 1280 PNG of 2.26 MB was being fetched on every landing and download
 * visit for a slot drawn at ~320 × 200, competing with the page's own content on
 * a phone. Supabase's image renderer serves the same picture, same proportions,
 * as WebP when the browser accepts it: 2.26 MB → 48 KB at 640 px (measured).
 *
 * The long edge is twice the slot's (retina), kept between 640 and 1600 px. Only
 * a Supabase public-object URL is rewritten; anything else is left exactly as is.
 *
 * 🔴 `resize=contain` is REQUIRED (owner, 2026-10-10, screenshot: the Samsung TV
 * ad cut at both sides). Given only a width, the renderer defaults to `cover`
 * and KEEPS THE ORIGINAL HEIGHT: a 1000 × 697 creative came back 640 × 697,
 * its sides cropped off. With `contain` it is 640 × 446 — the whole picture.
 */
const PUBLIC_OBJECT = "/storage/v1/object/public/";
const RENDER_IMAGE = "/storage/v1/render/image/public/";

export function slotImageEdge(slotWidth: number | null | undefined, slotHeight: number | null | undefined): number {
  const edge = Math.max(slotWidth ?? 0, slotHeight ?? 0) * 2;
  return Math.min(1600, Math.max(640, Math.round(edge)));
}

export function sizedAdImageUrl(url: string | null, edge: number): string | null {
  if (!url || !url.includes(PUBLIC_OBJECT) || url.includes("?")) return url;
  return `${url.replace(PUBLIC_OBJECT, RENDER_IMAGE)}?width=${edge}&resize=contain&quality=75`;
}
