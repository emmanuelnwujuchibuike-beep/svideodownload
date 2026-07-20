import type { MetadataRoute } from "next";

import { teachableSchools } from "@/lib/academy/schools";
import { LESSON_SLUGS } from "@/lib/learning/catalog";
import { SUPPORT_ARTICLES, articleHref } from "@/lib/support/articles";
import { BLOG_SLUGS } from "@/lib/seo/blog";
import { SEO_SLUGS } from "@/lib/seo/seo-pages";
import { SITE_URL as siteUrl } from "@/lib/site";

/*
  ── No sitemap index, and no image/video sitemap. Both deliberate. ────────────

  A sitemap INDEX exists to split a corpus past Google's per-file limit of
  50,000 URLs / 50MB. This sitemap carries 198. Adding an index would be a layer
  of indirection serving no crawler, and one more file to keep in step.
  Revisit if this passes ~10,000 URLs; the generated downloader pages are the
  only thing that could plausibly get there.

  An IMAGE sitemap was attempted and abandoned on evidence. The only per-page
  images we have are the generated OG cards, and their URLs are not stably
  addressable: `/tiktok-downloader/opengraph-image` 404s without the content
  hash Next appends. So the options were a sitemap full of URLs that break on
  the next deploy, or the same generic OG card repeated against all 198 entries
  — which tells an image crawler nothing and reads as spam. Neither is worth
  shipping. Real per-page artwork would change this.

  A VIDEO sitemap needs public pages whose primary content is a video. The
  marketing site has none — reels live behind the app, on user-generated
  content. Declaring video entries for pages that do not present video is the
  same fabrication the Reality Ledger exists to stop, in a file only machines
  read.
*/
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

  /*
    Support articles — both centres.

    The URL comes from `articleHref` rather than a prefix written here. One
    corpus feeds /help and /trust, and a sitemap that assumed /trust for every
    article would have advertised each Help Center page at a URL that 404s while
    never listing the one that works.

    High priority: these answer the questions people ask before trusting a
    service with an account, and the ones that otherwise become support load.
  */
  const support: MetadataRoute.Sitemap = SUPPORT_ARTICLES.map((article) => ({
    url: `${siteUrl}${articleHref(article)}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  return [
    { url: siteUrl, lastModified: now, changeFrequency: "daily", priority: 1 },
    ...downloaders,
    { url: `${siteUrl}/help`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${siteUrl}/trust`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${siteUrl}/glossary`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    ...support,
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
