/**
 * Single source of truth for the public site URL — used for canonicals,
 * sitemap, robots and OpenGraph. Set NEXT_PUBLIC_SITE_URL in the environment to
 * your primary domain (e.g. https://svideodownload.com once it's connected).
 * Until then we default to the live Vercel domain so canonicals point at a
 * real, indexable page rather than an unconnected domain.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://svideodownload.vercel.app"
).replace(/\/$/, "");
