import type { Metadata } from "next";
import { Suspense } from "react";

import { AppContent } from "@/features/app-shell/app-content";
import { LoadingStripe } from "@/features/ui/page-loader";
import { ExploreBrowser } from "@/features/explore/explore-browser";
import { isCategory, type Category } from "@/lib/social/categories";
import { getFeed, type FeedSort } from "@/lib/social/feed";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/*
  🔴 `robots: index:true` made explicit (2026-08-16 SEO audit). This was the
  only page in the (app) group with no `robots` field at all — every sibling
  route explicitly declares `index:false`, so this one's indexability was an
  accident of omission rather than a decision. It's real: genuinely public,
  signed-out-accessible community content (no login redirect — see the page
  body below), so the deliberate call is to index it and add it to the
  sitemap (app/sitemap.ts), not to noindex it to match its siblings by
  default. `sort`/`category` vary the results but canonical stays this one
  static path, so parameter variants consolidate rather than fragment.
*/
export const metadata: Metadata = {
  title: "Explore — trending downloads",
  description: "Discover trending and recent downloads shared by the FrenzSave community.",
  alternates: { canonical: "/explore" },
  robots: { index: true, follow: true },
};

/*
  🔴 Synchronous shell, streamed data — the cold-entry white-screen fix
  (owner, 2026-08-11). See app/(app)/home/page.tsx for why `loading.tsx` alone
  cannot fix a page that awaits at its top level.
*/
export default function ExplorePage(props: {
  searchParams: Promise<{ sort?: string; category?: string }>;
}) {
  return (
    <Suspense
      fallback={
        <AppContent>
          <LoadingStripe />
        </AppContent>
      }
    >
      <ExploreData {...props} />
    </Suspense>
  );
}

async function ExploreData({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; category?: string }>;
}) {
  const { sort: sortParam, category: catParam } = await searchParams;
  const sort: FeedSort = sortParam === "recent" ? "recent" : "trending";
  const category: Category | null = catParam && isCategory(catParam) ? catParam : null;

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

  const posts = await getFeed({ sort, category, viewerId });

  return (
    <AppContent>
      <div className="mx-auto max-w-5xl">
        <header className="mb-6">
          <h1 className="text-3xl font-bold tracking-[-0.03em] sm:text-4xl">Explore</h1>
          <p className="mt-2 text-muted-foreground">Trending &amp; fresh downloads from the community.</p>
        </header>

        {/* Instant client-side tabs/chips — switching never reloads the page */}
        <ExploreBrowser initialPosts={posts} initialSort={sort} initialCategory={category} />
      </div>
    </AppContent>
  );
}
