import type { Metadata } from "next";

import { AppContent } from "@/features/app-shell/app-content";
import { ExploreBrowser } from "@/features/explore/explore-browser";
import { isCategory, type Category } from "@/lib/social/categories";
import { getFeed, type FeedSort } from "@/lib/social/feed";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Explore — trending downloads",
  description: "Discover trending and recent downloads shared by the FrenzSave community.",
  alternates: { canonical: "/explore" },
};

export default async function ExplorePage({
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
