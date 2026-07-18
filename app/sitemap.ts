import type { MetadataRoute } from "next";

import { LESSON_SLUGS } from "@/lib/learning/lessons";
import { BLOG_SLUGS } from "@/lib/seo/blog";
import { SEO_SLUGS } from "@/lib/seo/seo-pages";
import { SITE_URL as siteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const downloaders: MetadataRoute.Sitemap = SEO_SLUGS.map((slug) => ({
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

  // Learning Academy. Priority above the blog because these are the pages the
  // ~100 generated downloader pages link INTO — they are the depth that turns
  // that keyword cluster into topical authority rather than thin duplication.
  const lessons: MetadataRoute.Sitemap = LESSON_SLUGS.map((slug) => ({
    url: `${siteUrl}/learn/${slug}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  return [
    { url: siteUrl, lastModified: now, changeFrequency: "daily", priority: 1 },
    ...downloaders,
    { url: `${siteUrl}/learn`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    ...lessons,
    { url: `${siteUrl}/blog`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    ...blog,
    { url: `${siteUrl}/about`, lastModified: now, priority: 0.5 },
    { url: `${siteUrl}/contact`, lastModified: now, priority: 0.4 },
    { url: `${siteUrl}/terms`, lastModified: now, priority: 0.3 },
    { url: `${siteUrl}/privacy`, lastModified: now, priority: 0.3 },
    { url: `${siteUrl}/dmca`, lastModified: now, priority: 0.3 },
  ];
}
