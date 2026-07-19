import type { MetadataRoute } from "next";

import { teachableSchools } from "@/lib/academy/schools";
import { LESSON_SLUGS } from "@/lib/learning/catalog";
import { SUPPORT_SLUGS } from "@/lib/support/articles";
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

  /*
    Knowledge Campus. Only TEACHABLE schools are listed — a school whose product
    does not exist has no page to point at, and listing one would be a 404 in the
    sitemap. `teachableSchools()` derives that from the Product Genome, so this
    stays correct with no maintenance when a product ships.

    Priority sits alongside /learn: these are the hub pages the ~148 generated
    downloader pages link into, which is what turns that keyword cluster into
    topical depth rather than thin duplication.
  */
  const schools: MetadataRoute.Sitemap = teachableSchools().map((school) => ({
    url: `${siteUrl}/academy/${school.slug}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  /* Trust Center. High priority: these are the pages people look for before
     trusting a service with an account, and they answer questions that otherwise
     become support load. */
  const trust: MetadataRoute.Sitemap = SUPPORT_SLUGS.map((slug) => ({
    url: `${siteUrl}/trust/${slug}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  return [
    { url: siteUrl, lastModified: now, changeFrequency: "daily", priority: 1 },
    ...downloaders,
    { url: `${siteUrl}/trust`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    ...trust,
    { url: `${siteUrl}/academy`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    ...schools,
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
