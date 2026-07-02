import { Flame, Clock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PostGrid } from "@/components/social/post-grid";
import { AppContent } from "@/features/app-shell/app-content";
import { CATEGORIES, categoryLabel, isCategory, type Category } from "@/lib/social/categories";
import { getFeed, type FeedSort } from "@/lib/social/feed";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Explore — trending downloads",
  description: "Discover trending and recent downloads shared by the FrenzSave community.",
  alternates: { canonical: "/explore" },
};

function hrefFor(sort: FeedSort, category: Category | null): string {
  const sp = new URLSearchParams();
  if (sort !== "trending") sp.set("sort", sort);
  if (category) sp.set("category", category);
  const q = sp.toString();
  return q ? `/explore?${q}` : "/explore";
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; category?: string }>;
}) {
  const { sort: sortParam, category: catParam } = await searchParams;
  const sort: FeedSort = sortParam === "recent" ? "recent" : "trending";
  const category = catParam && isCategory(catParam) ? catParam : null;

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

        {/* Sort tabs */}
        <div className="mb-4 inline-flex rounded-xl bg-secondary p-1">
          <Tab href={hrefFor("trending", category)} active={sort === "trending"} icon={Flame} label="Trending" />
          <Tab href={hrefFor("recent", category)} active={sort === "recent"} icon={Clock} label="Recent" />
        </div>

        {/* Category chips */}
        <div className="mb-7 flex flex-wrap gap-2">
          <Chip href={hrefFor(sort, null)} active={!category} label="All" />
          {CATEGORIES.map((c) => (
            <Chip key={c} href={hrefFor(sort, c)} active={category === c} label={categoryLabel(c)} />
          ))}
        </div>

        <PostGrid
          posts={posts}
          emptyText={
            category
              ? `No ${categoryLabel(category).toLowerCase()} posts yet.`
              : "Nothing here yet — publish a download to get started."
          }
        />
      </div>
    </AppContent>
  );
}

function Tab({ href, active, icon: Icon, label }: { href: string; active: boolean; icon: typeof Flame; label: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition",
        active ? "bg-background shadow" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" /> {label}
    </Link>
  );
}

function Chip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium transition",
        active ? "border-primary bg-primary/10 text-primary" : "border-border/70 text-muted-foreground hover:border-foreground/20",
      )}
    >
      {label}
    </Link>
  );
}
