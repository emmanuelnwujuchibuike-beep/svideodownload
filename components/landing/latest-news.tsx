import { Newspaper } from "lucide-react";
import Link from "next/link";

import { BLOG_POSTS } from "@/lib/seo/blog";

/** Landing "Latest News" — newest guides/updates from the blog. */
export function LatestNews() {
  const posts = [...BLOG_POSTS]
    .sort((a, b) => +new Date(b.date) - +new Date(a.date))
    .slice(0, 6);
  if (posts.length === 0) return null;

  return (
    <section className="container max-w-6xl py-12 sm:py-16">
      <div className="mb-5 flex items-end justify-between">
        <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
          <Newspaper className="h-6 w-6 text-primary" /> Latest news
        </h2>
        <Link href="/blog" className="text-sm font-medium text-primary hover:underline">
          View all news
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {posts.map((p) => (
          <Link
            key={p.slug}
            href={`/blog/${p.slug}`}
            className="group rounded-2xl border border-border/70 bg-card p-4 shadow-soft transition hover:-translate-y-0.5 hover:shadow-card"
          >
            <p className="text-[11px] font-medium uppercase tracking-wide text-primary">
              {new Date(p.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </p>
            <h3 className="mt-1.5 line-clamp-2 text-sm font-semibold leading-snug group-hover:underline">{p.title}</h3>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{p.description}</p>
            <p className="mt-2 text-[11px] text-muted-foreground">{p.readingMinutes} min read</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
