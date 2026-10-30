import type { MetadataRoute } from "next";

import { LESSON_SLUGS } from "@/lib/learning/catalog";
import { lessonDates } from "@/lib/learning/dates";
import { BLOG_POSTS } from "@/lib/seo/blog";
import { GUIDES } from "@/lib/seo/guides";
import { getPrimaryPages } from "@/lib/seo/seo-pages";
import { publishableClusters, topicHref } from "@/lib/seo/topics";
import { SITE_URL as siteUrl } from "@/lib/site";
import { SUPPORT_ARTICLES, articleHref } from "@/lib/support/articles";

/*
  ── No sitemap index, and no image/video sitemap. Both deliberate. ────────────

  A sitemap INDEX exists to split a corpus past Google's per-file limit of
  50,000 URLs / 50MB. This sitemap carries a couple of hundred. Adding an index
  would be a layer of indirection serving no crawler, and one more file to keep
  in step. Revisit if this passes ~10,000 URLs; the generated downloader pages
  are the only thing that could plausibly get there.

  An IMAGE sitemap was attempted and abandoned on evidence. The only per-page
  images we have are the generated OG cards, and their URLs are not stably
  addressable: `/tiktok-downloader/opengraph-image` 404s without the content
  hash Next appends. So the options were a sitemap full of URLs that break on
  the next deploy, or the same generic OG card repeated against every entry —
  which tells an image crawler nothing and reads as spam. Neither is worth
  shipping. Real per-page artwork would change this.

  /wallpapers is the one page where an image sitemap would genuinely earn its
  keep — it publishes real, distinct photographs. It is still not listed here,
  because the wallpaper set is operator-managed and changes between deploys
  while this file is generated at BUILD time: a static image sitemap would
  advertise yesterday's library. The page carries `ImageObject` structured data
  instead (lib/seo/wallpapers.ts), which is generated per request from the live
  list and so cannot go stale. A per-wallpaper route would change this.

  A VIDEO sitemap needs public pages whose primary content is a video. The
  marketing site has none — reels live behind the app, on user-generated
  content. Declaring video entries for pages that do not present video is the
  same fabrication the Reality Ledger exists to stop, in a file only machines
  read.
*/
/*
  ── lastmod: a real date or none (2026-10-09) ─────────────────────────────────

  Every entry used to carry the current time — the moment the sitemap was
  generated — so all ~125 URLs claimed to have changed on every fetch. Google
  only uses lastmod when it is "consistently and verifiably accurate"; one that
  always says "just now" teaches it to ignore the field for the whole site,
  which also throws away the real dates below. So an entry carries a date only
  when one exists (a blog post's date, a guide's `updated`) and omits it
  otherwise. Never reintroduce a build-time date (app/sitemap.test.ts).
*/
/*
  ═══════════════════════════════════════════════════════════════════════════
   🔴 ONLY PUBLIC CONTENT PAGES (owner, 2026-10-29, AdSense review)
  ═══════════════════════════════════════════════════════════════════════════

  The owner's list, exactly: the landing; About, Contact, Privacy, Terms, DMCA; the blog and its posts; /learn and its
  guides; the glossary; /topics and its pillars; Help and Trust with their articles; pricing; the public Frenz AI
  explainers (/frenz-ai — the TOOLS at /ai stay unlisted and noindex, lib/ai/ai-pages-not-indexed.test.ts);
  wallpapers; developers; the advertising pages; and the 11 platform pages (one per platform — config/seoPages.ts).

  Gone, on purpose — do not re-add:
    · every app-only route (lib/auth/app-only-paths.ts): /explore, /home, /reels, profiles, sounds, …
    · every merged downloader variant (lib/seo/removed-seo-pages.ts) — they 301, and a redirect is not a page;
    · the category hubs (/sports, /news, …): feeds of member posts, not publisher content;
    · /academy, /earn, /features and /support — not on the owner's list.
  app/sitemap.test.ts enforces the exclusions against the real output.
*/
export default function sitemap(): MetadataRoute.Sitemap {
  // the 11 platform pages — primaries only, so a variant added back to the config can never be listed by accident
  const downloaders: MetadataRoute.Sitemap = getPrimaryPages().map((page) => ({
    url: `${siteUrl}/${page.slug}`,
    changeFrequency: "weekly",
    priority: 0.9,
  }));

  const blog: MetadataRoute.Sitemap = BLOG_POSTS.map((post) => ({
    url: `${siteUrl}/blog/${post.slug}`,
    lastModified: post.updated ?? post.date,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  // real dates measured from git (lib/learning/dates.ts)
  const lessons: MetadataRoute.Sitemap = LESSON_SLUGS.map((slug) => ({
    url: `${siteUrl}/learn/${slug}`,
    lastModified: lessonDates(slug)?.updated,
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  /*
    Support articles — both centres. The URL comes from `articleHref` rather than a prefix written here: one corpus
    feeds /help and /trust, and a sitemap that assumed /trust for every article would list Help pages at URLs that 404.
  */
  const support: MetadataRoute.Sitemap = SUPPORT_ARTICLES.map((article) => ({
    url: `${siteUrl}${articleHref(article)}`,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  // only PUBLISHABLE pillars — the same gate generateStaticParams reads, so a pillar that was not generated never shows
  const topics: MetadataRoute.Sitemap = publishableClusters().map((cluster) => ({
    url: `${siteUrl}${topicHref(cluster.topic)}`,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  return [
    { url: siteUrl, changeFrequency: "daily", priority: 1 },
    ...downloaders,
    { url: `${siteUrl}/wallpapers`, changeFrequency: "daily", priority: 0.8 },
    // the public Frenz AI explainers and the advertising guides, each with its content's real last-change date
    ...GUIDES.map((g) => ({
      url: `${siteUrl}${g.path}`,
      lastModified: g.updated,
      changeFrequency: "monthly" as const,
      priority: g.path === "/frenz-ai" ? 0.8 : 0.7,
    })),
    { url: `${siteUrl}/advertise`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${siteUrl}/advertise/rules`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${siteUrl}/pricing`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${siteUrl}/developers`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${siteUrl}/help`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${siteUrl}/trust`, changeFrequency: "monthly", priority: 0.7 },
    ...support,
    { url: `${siteUrl}/glossary`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${siteUrl}/topics`, changeFrequency: "weekly", priority: 0.8 },
    ...topics,
    { url: `${siteUrl}/learn`, changeFrequency: "weekly", priority: 0.8 },
    ...lessons,
    { url: `${siteUrl}/blog`, changeFrequency: "weekly", priority: 0.7 },
    ...blog,
    { url: `${siteUrl}/about`, priority: 0.5 },
    { url: `${siteUrl}/contact`, priority: 0.4 },
    { url: `${siteUrl}/terms`, priority: 0.3 },
    { url: `${siteUrl}/privacy`, priority: 0.3 },
    { url: `${siteUrl}/dmca`, priority: 0.3 },
  ];
}
