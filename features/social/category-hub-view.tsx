import nextDynamic from "next/dynamic";

import { jsonLd } from "@/lib/seo/json-ld";
import { categoryLabel, type Category } from "@/lib/social/categories";
import { getFeed } from "@/lib/social/feed";
import { postHref } from "@/lib/social/post-url";
import { SITE_URL } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";

// The one genuinely client-bundle-affecting import here ("use client") —
// code-split so it never ships to the ~150 downloader-tool pages that share
// this route's page.tsx but never render this branch (see that file's own
// note on why this view exists at all). Same idiom post-page-view.tsx
// already uses for the identical component.
const PostGrid = nextDynamic(() => import("@/components/social/post-grid").then((m) => m.PostGrid));

export function categoryHubMetadata(category: Category) {
  const label = categoryLabel(category);
  return {
    title: `Latest ${label} content`,
    description: `Trending and recent ${label.toLowerCase()} videos and photos on Frenzsave.`,
    alternates: { canonical: `/${category}` },
    robots: { index: true, follow: true },
    openGraph: { type: "website" as const, title: `Latest ${label} content on Frenzsave` },
  };
}

/**
 * Category hub — a public, indexable landing page per category (section 7 of
 * the SEO brief). Doesn't try to enumerate every post — that's what
 * posts-sitemap.xml is for (bounded, comprehensive, DB-backed). This page's
 * job is to be a good crawlable ENTRY POINT with real links into stories
 * (PostGrid already renders real `<Link>`s) and pass link equity to them.
 */
export async function CategoryHubView({ category }: { category: Category }) {
  // Guest-safe: this page is reachable signed-out (cold SEO traffic), and a
  // signed-in visitor gets nothing personalized here either — getFeed with a
  // null viewerId is the same public, privacy-filtered discovery query
  // /explore already uses for its own category filter.
  let viewerId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    viewerId = user?.id ?? null;
  } catch {
    /* anon */
  }

  const posts = await getFeed({ sort: "trending", category, viewerId, limit: 48 });
  const label = categoryLabel(category);

  const ld = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `Latest ${label} content`,
    url: `${SITE_URL}/${category}`,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: posts.slice(0, 24).map((post, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${SITE_URL}${postHref(post)}`,
      })),
    },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <main className="container max-w-5xl pb-24 pt-[calc(var(--frenz-safe-top)+7rem)] sm:pt-[calc(var(--frenz-safe-top)+8rem)]">
        <header className="mb-6">
          {/*
            🔴 Hashtag identity (owner, 2026-08-18: "users who search for
            news, sport, politics... should land on the exact page with
            hashtag of the topic, #news, #sports" — confirmed: this means
            THIS page, the one Google indexes for that search). The H1
            itself stays the descriptive "Latest X content" phrasing
            (section 6 of the SEO brief wants natural, readable headings —
            a bare "#news" reads worse for search intent and accessibility),
            but the page now visibly IS the #topic page via this eyebrow,
            matching the hashtag chips throughout the app (feed captions,
            the post detail category badge) which now link straight here.
          */}
          <span className="text-sm font-semibold text-primary">#{category}</span>
          <h1 className="text-3xl font-bold tracking-[-0.03em] sm:text-4xl">Latest {label} content</h1>
          <p className="mt-2 text-muted-foreground">
            Trending and recent {label.toLowerCase()} videos and photos, shared by the Frenzsave community.
          </p>
        </header>

        <PostGrid posts={posts} emptyText={`No ${label.toLowerCase()} posts yet — check back soon.`} />
      </main>
    </>
  );
}
