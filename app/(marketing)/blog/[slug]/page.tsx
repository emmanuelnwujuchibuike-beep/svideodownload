import { ArrowLeft, ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { RecommendedTools } from "@/components/monetization/recommended-tools";
import { AdSlot } from "@/features/monetization/ad-slot";
import { BLOG_SLUGS, getPost } from "@/lib/seo/blog";
import { jsonLd } from "@/lib/seo/json-ld";
import { getSeoPage } from "@/lib/seo/seo-pages";
import { SITE_URL as siteUrl } from "@/lib/site";

/*
 * Static by contract, not by inference. Vercel was building `/` as DYNAMIC while
 * this repo built it static, which silently made it uncacheable at the edge and
 * cost ~800-4700ms of TTFB before anyone noticed. This page reads no cookies, no
 * headers and no searchParams, so it declares that rather than hoping the builder
 * infers it. ISR still applies via `revalidate` in app/layout.tsx.
 */
export const dynamic = "force-static";

export function generateStaticParams() {
  return BLOG_SLUGS.map((slug) => ({ slug }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return {};
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      publishedTime: post.date,
    },
    twitter: { card: "summary_large_image", title: post.title, description: post.description },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  const tool = post.toolSlug ? getSeoPage(post.toolSlug) : undefined;

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.date,
    author: { "@type": "Organization", name: "FrenzSave" },
    publisher: { "@type": "Organization", name: "FrenzSave" },
    mainEntityOfPage: `${siteUrl}/blog/${post.slug}`,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(articleLd) }}
      />
      <SiteHeader />
      <main className="container max-w-3xl pb-24 pt-28 sm:pt-32">
        <Link
          href="/blog"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> All guides
        </Link>

        {/* Gradient cover hero */}
        <div className="relative mt-5 overflow-hidden rounded-3xl bg-gradient-to-br from-blue-600 via-violet-600 to-purple-700 p-8 shadow-elevated sm:p-12">
          <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-white/15 blur-3xl" />
          <div className="relative">
            <div className="flex items-center gap-3 text-xs font-medium text-white/80">
              <time dateTime={post.date}>
                {new Date(post.date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
              </time>
              <span>·</span>
              <span>{post.readingMinutes} min read</span>
            </div>
            <h1 className="mt-3 text-3xl font-extrabold tracking-[-0.02em] text-white sm:text-4xl sm:leading-[1.1]">
              {post.title}
            </h1>
            <p className="mt-4 max-w-2xl text-base text-white/85 sm:text-lg">{post.description}</p>
          </div>
        </div>

        <article className="mt-10">
          <div className="space-y-8">
            {post.body.map((section, i) => (
              <section key={i}>
                {section.heading ? (
                  <h2 className="mb-3 text-xl font-semibold tracking-[-0.01em] sm:text-2xl">
                    {section.heading}
                  </h2>
                ) : null}
                {section.paragraphs?.map((p) => (
                  <p
                    key={p.slice(0, 24)}
                    className="mb-4 leading-relaxed text-muted-foreground"
                  >
                    {p}
                  </p>
                ))}
                {section.bullets ? (
                  <ul className="ml-1 space-y-2">
                    {section.bullets.map((b) => (
                      <li
                        key={b.slice(0, 24)}
                        className="flex gap-2.5 text-muted-foreground"
                      >
                        <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                        <span className="leading-relaxed">{b}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>

          <AdSlot zone="sidebar" className="my-10" />

          <RecommendedTools placement="blog" title="Recommended tools" className="my-10" />

          {tool ? (
            <div className="relative mt-12 overflow-hidden rounded-3xl bg-gradient-to-br from-blue-600 via-violet-600 to-fuchsia-600 p-6 shadow-elevated sm:p-8">
              <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/15 blur-3xl" />
              <div className="relative">
                <h2 className="text-xl font-bold text-white">Try it now</h2>
                <p className="mt-2 text-sm text-white/85">
                  Use our free {tool.primaryKeyword} — no app, no login, no watermark.
                </p>
                <Link
                  href={`/${tool.slug}`}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 shadow-lg transition hover:bg-white/90 active:scale-[0.99]"
                >
                  Open the {tool.brand} downloader
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          ) : null}
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
