import { Flame } from "lucide-react";
import Link from "next/link";

import { PostGrid } from "@/components/social/post-grid";
import { CATEGORIES, categoryLabel } from "@/lib/social/categories";
import { getFeed } from "@/lib/social/feed";

/** Landing "Trending Today" — pulls the real trending feed; chips link to Explore. */
export async function TrendingToday() {
  const posts = await getFeed({ sort: "trending", viewerId: null, limit: 6 });

  return (
    <section className="container max-w-6xl py-12 sm:py-16">
      <div className="mb-5 flex items-end justify-between">
        <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
          <Flame className="h-6 w-6 text-rose-500" /> Trending today
        </h2>
        <Link href="/explore" className="text-sm font-medium text-primary hover:underline">
          View all
        </Link>
      </div>

      {/* Category chips */}
      <div className="mb-6 flex flex-wrap gap-2">
        <Link href="/explore" className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
          All
        </Link>
        {CATEGORIES.slice(0, 8).map((c) => (
          <Link
            key={c}
            href={`/explore?category=${c}`}
            className="rounded-full border border-border/70 px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-foreground/20 hover:text-foreground"
          >
            {categoryLabel(c)}
          </Link>
        ))}
      </div>

      {posts.length > 0 ? (
        <PostGrid posts={posts} />
      ) : (
        <div className="rounded-2xl border border-dashed border-border/70 p-10 text-center">
          <p className="text-sm text-muted-foreground">No trending posts yet.</p>
          <Link href="/#download" className="mt-3 inline-block text-sm font-semibold text-primary hover:underline">
            Download something and publish it →
          </Link>
        </div>
      )}
    </section>
  );
}
