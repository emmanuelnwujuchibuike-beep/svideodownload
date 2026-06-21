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
    title: "SVideoDownload Blog — Downloading Guides",
    description:
      "How-to guides for downloading videos from TikTok, Instagram, YouTube and more.",
  },
};

export default function BlogIndex() {
  const posts = [...BLOG_POSTS].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <>
      <SiteHeader />
      <main>
        <section className="container max-w-4xl pt-28 sm:pt-36">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-3 py-1 text-xs font-medium text-muted-foreground">
            <BookOpen className="h-3 w-3" /> Blog
          </span>
          <h1 className="mt-5 text-3xl font-semibold tracking-[-0.02em] sm:text-5xl">
            Video downloading guides
          </h1>
          <p className="mt-3 max-w-xl text-lg text-muted-foreground">
            Practical, no-nonsense guides to saving videos in HD — safely and on
            any device.
          </p>

          <div className="mt-12 grid gap-5">
            {posts.map((post) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="group rounded-3xl border border-border bg-card p-6 shadow-soft transition hover:border-foreground/20 hover:shadow-card sm:p-8"
              >
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <time dateTime={post.date}>
                    {new Date(post.date).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </time>
                  <span>·</span>
                  <span>{post.readingMinutes} min read</span>
                </div>
                <h2 className="mt-3 text-xl font-semibold tracking-[-0.01em] sm:text-2xl">
                  {post.title}
                </h2>
                <p className="mt-2 text-muted-foreground">{post.description}</p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                  Read guide
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </span>
              </Link>
            ))}
          </div>
        </section>

        <div className="mt-16">
          <DownloaderLinks heading="Free downloader tools" />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
