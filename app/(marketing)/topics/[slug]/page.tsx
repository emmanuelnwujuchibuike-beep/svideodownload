import { ArrowRight, BookOpen, Clock, FileText, Hash, LifeBuoy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { DownloaderLinks } from "@/components/seo/downloader-links";
import { jsonLd } from "@/lib/seo/json-ld";
import {
  clusterFor,
  clusterLinks,
  getTopicBySlug,
  isPublishable,
  publishableTopicSlugs,
  seoPagesAcrossPlatforms,
  topicHref,
} from "@/lib/seo/topics";
import { SITE_URL as siteUrl } from "@/lib/site";

export const dynamic = "force-static";

/**
 * A topic pillar — the hub of a subject cluster.
 *
 * ── Only for clusters that earned one ─────────────────────────────────────────
 *
 * `generateStaticParams` reads `publishableTopicSlugs()`, so a subject with too
 * little written about it produces no page at all rather than a hub linking to
 * two things. Same stance as planned schools: a real URL in the sitemap with
 * nothing on it costs topical authority instead of building it, and it is the
 * exact thin-content pattern the ~148 keyword pages are always at risk of.
 *
 * ── What makes this a pillar rather than a list ───────────────────────────────
 *
 * It opens with the reader's SITUATION (`topic.intent`), not with our feature
 * set. Everything below is grouped by what kind of answer it is — a lesson to
 * work through, an article answering one question, a definition, a
 * platform-specific page — because "which of these do I want" is the actual
 * decision a visitor makes here.
 *
 * ── The keyword pages are capped, deliberately ────────────────────────────────
 *
 * `saving-video` matches 148 of them. Rendering all 148 would bury the handful
 * of deep guides that are the reason the pillar exists, and a page of 148
 * near-identical links reads as a doorway page to a crawler. A dozen, then a
 * link to the hub that legitimately lists the rest.
 */

/** How many platform keyword pages a pillar shows before deferring to the hub. */
const SEO_PAGE_LIMIT = 12;

export function generateStaticParams() {
  return publishableTopicSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const topic = getTopicBySlug(slug);
  if (!topic) return {};

  return {
    title: `${topic.title} — Frenzsave`,
    description: topic.description,
    alternates: { canonical: topicHref(topic) },
  };
}

function Group({
  icon,
  title,
  blurb,
  items,
  showMeta,
}: {
  icon: React.ReactNode;
  title: string;
  blurb: string;
  items: { href: string; title: string; description: string; minutes?: number }[];
  showMeta?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <section className="mt-12">
      <h2 className="flex items-center gap-2 text-xl font-semibold tracking-[-0.02em]">
        {icon}
        {title}
      </h2>
      <p className="mt-1.5 text-sm text-muted-foreground">{blurb}</p>
      <ul className="mt-5 space-y-3">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="group flex items-start justify-between gap-4 rounded-xl border border-border/70 bg-card p-4 transition hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="min-w-0">
                <span className="block font-medium group-hover:text-primary">{item.title}</span>
                <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
                  {item.description}
                </span>
                {showMeta && typeof item.minutes === "number" && (
                  <span className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock aria-hidden className="h-3.5 w-3.5" />
                    {item.minutes} min read
                  </span>
                )}
              </span>
              <ArrowRight
                aria-hidden
                className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function TopicPillarPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const topic = getTopicBySlug(slug);
  if (!topic) notFound();

  const cluster = clusterFor(topic);
  // Belt and braces with generateStaticParams — if the gate ever changes shape,
  // this route must not become the one place a held-back pillar leaks out.
  if (!isPublishable(cluster)) notFound();

  const links = clusterLinks(cluster);
  const url = `${siteUrl}${topicHref(topic)}`;
  /*
    Spread across platforms rather than sliced in corpus order — the corpus is
    grouped by platform, so a slice returns one platform's pages and nothing
    else. See `seoPagesAcrossPlatforms`.
  */
  const shownSeo = seoPagesAcrossPlatforms(cluster, SEO_PAGE_LIMIT).map((page) => ({
    href: `/${page.slug}`,
    title: page.h1,
    description: page.tagline,
  }));
  const hiddenSeo = links.seoPages.length - shownSeo.length;

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Topics", item: `${siteUrl}/topics` },
      { "@type": "ListItem", position: 2, name: topic.title, item: url },
    ],
  };

  /*
    CollectionPage, not Article. This page is a hub over other pages and does not
    itself carry the substance — claiming otherwise is the kind of small schema
    lie that propagates into third-party knowledge bases and outlives the fix.
  */
  const collectionLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: topic.title,
    description: topic.description,
    url,
    isPartOf: { "@type": "WebSite", name: "Frenzsave", url: siteUrl },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: [...links.lessons, ...links.articles].map((item, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: item.title,
        url: `${siteUrl}${item.href}`,
      })),
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd([breadcrumbLd, collectionLd]) }}
      />
      <SiteHeader />
      <main>
        <section className="border-b border-border/60 pb-12 pt-[calc(var(--frenz-safe-top)+7rem)] sm:pt-[calc(var(--frenz-safe-top)+8rem)]">
          <div className="container max-w-3xl">
            <nav aria-label="Breadcrumb" className="mb-6">
              <ol className="flex items-center gap-2 text-sm text-muted-foreground">
                <li>
                  <Link href="/topics" className="transition hover:text-foreground">
                    Topics
                  </Link>
                </li>
                <li aria-hidden>/</li>
                <li aria-current="page" className="text-foreground">
                  {topic.title}
                </li>
              </ol>
            </nav>
            <h1 className="text-balance text-[2rem] font-extrabold leading-[1.1] tracking-[-0.03em] sm:text-4xl">
              {topic.title}
            </h1>
            {/* The reader's situation, before anything about us. */}
            <p className="mt-4 text-pretty text-lg leading-relaxed text-muted-foreground">
              {topic.intent}
            </p>
            <p className="mt-3 text-pretty leading-relaxed text-muted-foreground">
              {topic.description}
            </p>
          </div>
        </section>

        <div className="container max-w-3xl pb-20">
          <Group
            icon={<BookOpen aria-hidden className="h-5 w-5 text-primary" />}
            title="Guides"
            blurb="Worked through end to end. Start here if you want to understand the subject rather than fix one thing."
            items={links.lessons}
            showMeta
          />

          <Group
            icon={<LifeBuoy aria-hidden className="h-5 w-5 text-primary" />}
            title="Answers"
            blurb="One question, one answer. Start here if you already know what you need."
            items={links.articles}
          />

          <Group
            icon={<Hash aria-hidden className="h-5 w-5 text-primary" />}
            title="Definitions"
            blurb="The words this subject assumes you already know."
            items={links.glossary}
          />

          {shownSeo.length > 0 && (
            <>
              <Group
                icon={<FileText aria-hidden className="h-5 w-5 text-primary" />}
                title="By platform"
                blurb="The same subject, specific to where your media came from."
                items={shownSeo}
              />
              {hiddenSeo > 0 && (
                <p className="mt-4 text-sm text-muted-foreground">
                  {hiddenSeo} more platform-specific {hiddenSeo === 1 ? "page" : "pages"} exist for
                  this subject — the cluster primaries are listed below.
                </p>
              )}
            </>
          )}
        </div>

        {/*
          Only when the topic-specific list above was actually TRUNCATED.

          Rendered unconditionally, this sat directly beneath the "By platform"
          group and produced two near-identical grids of platform links on one
          page — which is the doorway-page pattern the cap above exists to
          avoid, reintroduced immediately below it. It only earns its place when
          there are pages the cap hid, where it is the honest "see all of them"
          destination rather than a second copy of what is already on screen.

          Caught by looking at the rendered page; both grids are individually
          correct and the duplication is invisible in the source.
        */}
        {hiddenSeo > 0 && <DownloaderLinks heading="Every supported platform" />}
      </main>
      <SiteFooter />
    </>
  );
}
