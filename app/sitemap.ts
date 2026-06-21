import type { MetadataRoute } from "next";

import { BLOG_SLUGS } from "@/lib/seo/blog";
import { DOWNLOADER_SLUGS } from "@/lib/seo/downloaders";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://svideodownload.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const downloaders: MetadataRoute.Sitemap = DOWNLOADER_SLUGS.map((slug) => ({
    url: `${siteUrl}/${slug}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.9,
  }));

  const blog: MetadataRoute.Sitemap = BLOG_SLUGS.map((slug) => ({
    url: `${siteUrl}/blog/${slug}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  return [
    { url: siteUrl, lastModified: now, changeFrequency: "daily", priority: 1 },
    ...downloaders,
    { url: `${siteUrl}/blog`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    ...blog,
    { url: `${siteUrl}/about`, lastModified: now, priority: 0.5 },
    { url: `${siteUrl}/contact`, lastModified: now, priority: 0.4 },
    { url: `${siteUrl}/terms`, lastModified: now, priority: 0.3 },
    { url: `${siteUrl}/privacy`, lastModified: now, priority: 0.3 },
    { url: `${siteUrl}/dmca`, lastModified: now, priority: 0.3 },
  ];
}
