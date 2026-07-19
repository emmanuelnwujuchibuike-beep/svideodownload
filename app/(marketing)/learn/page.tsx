import { GraduationCap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { LESSON_CATALOG } from "@/lib/learning/catalog";
import type { LessonTopic } from "@/lib/learning/types";
import { jsonLd } from "@/lib/seo/json-ld";
import { SITE_URL as siteUrl } from "@/lib/site";

/*
 * Static by contract, not by inference. Vercel was building `/` as DYNAMIC while
 * this repo built it static, which silently made it uncacheable at the edge and
 * cost ~800-4700ms of TTFB before anyone noticed. This page reads no cookies, no
 * headers and no searchParams, so it declares that rather than hoping the builder
 * infers it. ISR still applies via `revalidate` in app/layout.tsx.
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Learning Academy — guides for saving, editing and publishing media",
  description:
    "Practical guides on downloading responsibly, editing without quality loss, writing captions, and building a creator workflow.",
  alternates: { canonical: "/learn" },
};

/**
 * Learning Academy™ index. See `docs/DOWNLOAD_HUB_RFC.md` §4.
 *
 * Statically generated — no data source, no request. The lessons are a typed
 * array, so this page costs nothing against the 2-second entry budget.
 */

const TOPIC_LABELS: Record<LessonTopic, string> = {
  downloading: "Downloading",
  editing: "Editing",
  captions: "Captions",
  quality: "Quality",
  organising: "Organising",
  publishing: "Publishing",
};

const TOPIC_ORDER: LessonTopic[] = [
  "downloading",
  "editing",
  "captions",
  "quality",
  "organising",
  "publishing",
];

export default function LearnIndexPage() {
  const collectionLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Frenz Learning Academy",
    description: metadata.description,
    url: `${siteUrl}/learn`,
    hasPart: LESSON_CATALOG.map((l) => ({
      "@type": "Article",
      headline: l.title,
      description: l.description,
      url: `${siteUrl}/learn/${l.slug}`,
    })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(collectionLd) }} />
      <SiteHeader />
      <main className="container max-w-5xl pb-24 pt-28 sm:pt-32">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-sky-600 via-blue-600 to-violet-700 p-8 shadow-elevated sm:p-12">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-white/15 blur-3xl"
          />
          <div className="relative">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white">
              <GraduationCap className="h-3.5 w-3.5" /> Learning Academy
            </span>
            <h1 className="mt-4 text-3xl font-extrabold tracking-[-0.02em] text-white sm:text-4xl sm:leading-[1.1]">
              Get more out of everything you save
            </h1>
            <p className="mt-4 max-w-2xl text-base text-white/85 sm:text-lg">
              Short, practical guides on saving media responsibly, editing without wrecking
              quality, writing captions people actually read, and building a workflow you can
              keep to.
            </p>
          </div>
        </div>

        <div className="mt-12 space-y-12">
          {TOPIC_ORDER.map((topic) => {
            const lessons = LESSON_CATALOG.filter((l) => l.topic === topic);
            if (lessons.length === 0) return null;
            return (
              <section key={topic}>
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
                  {TOPIC_LABELS[topic]}
                </h2>
                <ul className="mt-4 grid gap-4 sm:grid-cols-2">
                  {lessons.map((lesson) => (
                    <li key={lesson.slug}>
                      <Link
                        href={`/learn/${lesson.slug}`}
                        className="group flex h-full flex-col rounded-2xl border border-border/60 p-5 transition-colors hover:border-border hover:bg-secondary/50"
                      >
                        <h3 className="text-lg font-semibold tracking-[-0.01em] group-hover:text-primary">
                          {lesson.title}
                        </h3>
                        <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                          {lesson.description}
                        </p>
                        <span className="mt-4 text-xs font-medium text-muted-foreground/70">
                          {lesson.minutes} min read
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
