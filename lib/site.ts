/**
 * Single source of truth for the public site URL — used for canonicals,
 * sitemap, robots and OpenGraph. Set NEXT_PUBLIC_SITE_URL in the environment to
 * override; it defaults to the primary production domain.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://frenzsave.com"
).replace(/\/$/, "");
