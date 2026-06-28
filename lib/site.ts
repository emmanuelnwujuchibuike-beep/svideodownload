/**
 * Single source of truth for the public site URL — used for canonicals,
 * sitemap, robots and OpenGraph (incl. the share/preview image host).
 *
 * Resolution order, so the OG image is always fetched from a host that's
 * actually serving the site (a wrong host = no share preview):
 *   1. NEXT_PUBLIC_SITE_URL        — explicit override (your custom domain)
 *   2. VERCEL_PROJECT_PRODUCTION_URL — the project's stable production domain
 *   3. VERCEL_URL                  — the current deployment (preview builds)
 *   4. https://frenzsave.com       — last-resort default
 *
 * Set NEXT_PUBLIC_SITE_URL to your canonical domain once its DNS is connected.
 */
function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit;

  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (prod) return `https://${prod}`;

  const deployment = process.env.VERCEL_URL?.trim();
  if (deployment) return `https://${deployment}`;

  return "https://frenzsave.com";
}

export const SITE_URL = resolveSiteUrl().replace(/\/$/, "");
