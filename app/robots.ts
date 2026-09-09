import type { MetadataRoute } from "next";

import { SITE_URL as siteUrl } from "@/lib/site";

/**
 * Robots policy.
 *
 * `/api/` and `/admin/` stay disallowed: one is machine surface with no content
 * worth indexing, the other is authenticated and must never surface in a result.
 *
 * ── On AI crawlers ────────────────────────────────────────────────────────────
 *
 * They are deliberately ALLOWED, and that is a decision rather than an oversight.
 * Frenzsave's problem is being found and described ACCURATELY, and an increasing
 * share of that now happens by someone asking a model rather than searching.
 * Blocking these agents would not protect anything — the content is already
 * public — it would only remove us from the answers.
 *
 * They are named individually rather than left to the wildcard because several
 * apply their own defaults when unnamed, and because an explicit list is the
 * honest place to revisit this later: a reader can see the policy was chosen.
 */
export default function robots(): MetadataRoute.Robots {
  /*
    ── 🔴 `/ai` IS DISALLOWED (owner, 2026-09-09) ────────────────────────────

    The permanent Frenz AI product rule: "Ensure robots configuration does not
    accidentally expose private AI pages… Treat Frenz AI as a private
    authenticated utility, not as a public landing-page product."

    `/ai` was deliberately public and crawlable from 2026-09-08, so that the
    AdSense reviewer could see the feature. That decision has been reversed, and
    reversing it properly means three separate things — none of which is
    sufficient alone:

      1. this line, so a compliant crawler does not request the route;
      2. `robots: { index: false, follow: false }` on the pages themselves, so
         a crawler that arrives by a link does not index what it finds (a
         `Disallow` alone can still produce a URL-only result);
      3. the sitemap entries and the guide route removed outright.

    ⚠️ `/studio/` is NOT listed, and does not need to be: every route under it
    redirects an unauthenticated request to sign-in, so a crawler receives no
    content to index. This one does need listing precisely because `/ai` served
    real HTML to anonymous visitors by design.
  */
  const disallow = ["/api/", "/admin/", "/ai", "/ai/"];
  const aiAgents = [
    "GPTBot",
    "OAI-SearchBot",
    "ChatGPT-User",
    "ClaudeBot",
    "Claude-Web",
    "PerplexityBot",
    "Google-Extended",
    "Applebot-Extended",
    "CCBot",
  ];

  return {
    rules: [
      { userAgent: "*", allow: "/", disallow },
      ...aiAgents.map((userAgent) => ({ userAgent, allow: "/", disallow })),
    ],
    // posts-sitemap.xml (every public post) and news-sitemap.xml (category
    // "news" posts from the last 48h, Google News format) are DB-backed
    // route handlers, kept separate from the static sitemap.xml above — see
    // either file's own top-of-file note for why.
    sitemap: [`${siteUrl}/sitemap.xml`, `${siteUrl}/posts-sitemap.xml`, `${siteUrl}/news-sitemap.xml`],
    host: siteUrl,
  };
}
