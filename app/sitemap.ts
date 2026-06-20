import type { MetadataRoute } from "next";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://svideodownload.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    { url: siteUrl, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${siteUrl}/about`, lastModified: now, priority: 0.5 },
    { url: `${siteUrl}/contact`, lastModified: now, priority: 0.4 },
    { url: `${siteUrl}/terms`, lastModified: now, priority: 0.3 },
    { url: `${siteUrl}/privacy`, lastModified: now, priority: 0.3 },
    { url: `${siteUrl}/dmca`, lastModified: now, priority: 0.3 },
  ];
}
