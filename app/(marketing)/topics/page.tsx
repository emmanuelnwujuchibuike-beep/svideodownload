import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { jsonLd } from "@/lib/seo/json-ld";
import { publishableClusters, topicHref } from "@/lib/seo/topics";
import { SITE_URL as siteUrl } from "@/lib/site";

export const dynamic = "force-static";

/**
 * The topic index — the subject axis, one level up.
 *
 * ── Why this exists rather than only the pillars ──────────────────────────────
 *
 * Three pages shipped once before that nothing linked to, and the owner found
 * them, not the tests. A pillar reachable only from a lesson back-link would be
 * the same mistake in a new place. This is the surface that makes the subject
 * axis navigable, and it is registered in the nav and footer alongside it —
 * `navigation.test.ts` requires that of every top-level content surface.
 *
 * ── Only published clusters appear ────────────────────────────────────────────
 *
 * A held-back subject is absent, not greyed out. There is nothing for a reader
 * to do with "we will write about captions eventually", and unlike the Academy
 * campus — where a declared-but-planned school tells you where the product is
 * going — a thin topic says nothing about direction, only about our backlog.
 */
export const metadata: Metadata = {
  title: "Topics — Frenzsave",
  description:
    "Everything we have written, grouped by subject: saving video, quality, editing, captions, audience, privacy and the API.",
  alternates: { canonical: "/topics" },
};

export default function TopicsIndexPage() {
  const clusters = publishableClusters();

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Topics", item: `${siteUrl}/topics` },
    ],
  };

  const listLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Topics",
    description: metadata.description,
    url: `${siteUrl}/topics`,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: clusters.map((cluster, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: cluster.topic.title,
        url: `${siteUrl}${topicHref(cluster.topic)}`,
      })),
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd([breadcrumbLd, listLd]) }}
      />
      <SiteHeader />
      <main>
        <section className="border-b border-border/60 pb-12 pt-[calc(var(--frenz-safe-top)+7rem)] sm:pt-[calc(var(--frenz-safe-top)+8rem)]">
          <div className="container max-w-3xl">
            <h1 className="text-balance text-[2rem] font-extrabold leading-[1.1] tracking-[-0.03em] sm:text-4xl">
              Topics
            </h1>
            <p className="mt-4 text-pretty text-lg leading-relaxed text-muted-foreground">
              Everything we have written, grouped by what it is actually about rather than by
              which platform it came from.
            </p>
          </div>
        </section>

        <section className="py-12 sm:py-14">
          <div className="container max-w-3xl">
            <ul className="space-y-3">
              {clusters.map((cluster) => (
                <li key={cluster.topic.slug}>
                  <Link
                    href={topicHref(cluster.topic)}
                    className="group flex items-start justify-between gap-4 rounded-2xl border border-border/70 bg-card p-5 transition hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span className="min-w-0">
                      <span className="block text-lg font-semibold tracking-[-0.01em] group-hover:text-primary">
                        {cluster.topic.title}
                      </span>
                      <span className="mt-1.5 block text-sm leading-relaxed text-muted-foreground">
                        {cluster.topic.intent}
                      </span>
                      {/*
                        A real count of real destinations. It is derived, so it
                        cannot overstate what is behind the link — which is the
                        only reason it is worth showing at all.
                      */}
                      <span className="mt-2.5 block text-xs text-muted-foreground">
                        {cluster.lessons.length} {cluster.lessons.length === 1 ? "guide" : "guides"}
                        {cluster.articles.length > 0 && ` · ${cluster.articles.length} answers`}
                        {cluster.glossary.length > 0 && ` · ${cluster.glossary.length} definitions`}
                      </span>
                    </span>
                    <ArrowRight
                      aria-hidden
                      className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
