import type { MetadataRoute } from "next";

import { SHOWCASE_PLATFORMS } from "@/lib/platforms";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://svideodownload.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: siteUrl, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${siteUrl}/terms`, lastModified: now, priority: 0.3 },
    { url: `${siteUrl}/privacy`, lastModified: now, priority: 0.3 },
    { url: `${siteUrl}/dmca`, lastModified: now, priority: 0.3 },
  ];

  // Per-platform landing pages are strong SEO targets (e.g. /download/tiktok).
  const platformRoutes: MetadataRoute.Sitemap = SHOWCASE_PLATFORMS.map((p) => ({
    url: `${siteUrl}/download/${p.id}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: p.id === "tiktok" ? 0.9 : 0.7,
  }));

  return [...staticRoutes, ...platformRoutes];
}
