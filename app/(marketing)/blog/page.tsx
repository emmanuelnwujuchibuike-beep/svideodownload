import { ArrowRight, BookOpen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { DownloaderLinks } from "@/components/seo/downloader-links";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { BLOG_POSTS } from "@/lib/seo/blog";

export const metadata: Metadata = {
  title: "Blog — Video Downloading Guides & Tips",
  description:
    "Guides on downloading videos from TikTok, Instagram, YouTube and more — safely, in HD, on any device.",
  alternates: { canonical: "/blog" },
  openGraph: {
    type: "website",
    title: "FrenzSave Blog — Downloading Guides",
    description:
      "How-to guides for downloading videos from TikTok, Instagram, YouTube and more.",
  },
};

const COVER_GRADIENTS = [
  "from-blue-500 to-indigo-600",
  "from-violet-500 to-purple-600",
  "from-rose-500 to-pink-600",
  "from-cyan-500 to-blue-600",
  "from-fuchsia-500 to-purple-600",
  "from-emerald-500 to-teal-600",
];

export default function BlogIndex() {
  const posts = [...BLOG_POSTS].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <>
      <SiteHeader />
      <main>
        <section className="container max-w-6xl pt-28 text-center sm:pt-36">
          <span className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-blue-500/10 to-violet-500/10 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-violet-600 ring-1 ring-inset ring-violet-500/20 dark:text-violet-300">
            <BookOpen className="h-3.5 w-3.5 text-amber-500" /> Latest News & Guides
          </span>
          <h1 className="mx-auto mt-6 max-w-2xl text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">
            Video downloading <span className="text-gradient">guides</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground sm:text-lg">
            Practical, no-nonsense guides to saving videos in HD — safely and on any device.
          </p>
        </section>

        <section className="container max-w-6xl py-12 sm:py-16">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post, i) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="group flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-card shadow-soft transition hover:-translate-y-1 hover:border-foreground/15 hover:shadow-card"
              >
                <div className={`relative aspect-video bg-gradient-to-br ${COVER_GRADIENTS[i % COVER_GRADIENTS.length]}`}>
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/25 text-white backdrop-blur transition group-hover:bg-white/40">
                      <BookOpen className="h-5 w-5" />
                    </span>
                  </span>
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
                    <time dateTime={post.date}>
                      {new Date(post.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </time>
                    <span>·</span>
                    <span>{post.readingMinutes} min read</span>
                  </div>
                  <h2 className="mt-2 text-lg font-bold leading-snug tracking-[-0.01em] group-hover:text-primary">
                    {post.title}
                  </h2>
                  <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{post.description}</p>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                    Read guide
                    <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <DownloaderLinks heading="Free downloader tools" />
      </main>
      <SiteFooter />
    </>
  );
}
