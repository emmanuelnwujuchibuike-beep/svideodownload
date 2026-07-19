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
  const disallow = ["/api/", "/admin/"];
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
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
