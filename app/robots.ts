import type { MetadataRoute } from "next";

import { APP_ONLY_PREFIXES } from "@/lib/auth/app-only-paths";
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
  /*
    2026-10-09 (SEO brief): the PUBLIC Frenz AI explainers live at /frenz-ai
    (lib/seo/guides.ts) and are crawlable — "/ai" is a path prefix and never
    matches "/frenz-ai". The tools under /ai stay disallowed, as above.
  */
  /*
    ── THE APP-ONLY ROUTES ARE DISALLOWED (owner, 2026-10-29, AdSense review) ──────
    Feeds, reels, profiles, sounds, messages and settings: every one sends a guest to /login before any render
    (middleware.ts) and carries noindex, so a crawler has nothing to gain from them. Listed from the same array the
    middleware reads (lib/auth/app-only-paths.ts), so the two can never disagree. Each route is given as the exact
    path (`/u$` — `$` anchors the end, honoured by Google and Bing) plus everything under it (`/u/`): a bare `/u`
    is a PREFIX rule and would also block `/unsubscribe`. Profiles at "/<handle>" cannot be listed here (a handle
    is any word); they redirect guests to sign-in and are noindex, which is what keeps them out of results.

    🔴 /_next/ is NOT disallowed and must never be: Google renders pages with their scripts and styles, and a page
    it cannot render is a page it cannot judge.
  */
  const disallow = ["/api/", "/admin/", "/ai", "/ai/", ...APP_ONLY_PREFIXES.flatMap((p) => [`${p}$`, `${p}/`])];
  /*
    ── 🔴 ads.txt IS ALWAYS FETCHABLE, AND SAYS SO (2026-09-20) ────────────────

    Owner: AdSense reported "ads.txt not found" for days and suspected the /ai
    rule above. Audited from outside as Mediapartners-Google and Googlebot:
    /ads.txt answers 200 text/plain with the record on apex, www and http→https,
    and "/ai" is a path prefix that never matches "/ads.txt". The rule could not
    have caused it — but a crawler reading a longer Allow beside the Disallows
    has no judgement call left to make, so the file is named here explicitly.
    Nothing in this file ever blocks a Google crawler; the AI-page rule is lifted
    in a coming part when those pages are indexed.
  */
  const allow = ["/", "/ads.txt"];
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
      { userAgent: "*", allow, disallow },
      ...aiAgents.map((userAgent) => ({ userAgent, allow, disallow })),
    ],
    /*
      The one sitemap: public content pages only (owner, 2026-10-29). posts-sitemap.xml and news-sitemap.xml (member
      posts) are no longer advertised — member content is not what this site asks Google to index. Both routes still
      answer; remove them from Search Console if they were submitted there.
    */
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
