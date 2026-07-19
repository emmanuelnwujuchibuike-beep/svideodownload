import { ArrowLeft, ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { LESSON_SLUGS, relatedLessons } from "@/lib/learning/catalog";
import { getLesson } from "@/lib/learning/lessons";
import { jsonLd } from "@/lib/seo/json-ld";
import { getPrimaryPages } from "@/lib/seo/seo-pages";
import { SITE_URL as siteUrl } from "@/lib/site";

/*
 * Static by contract, not by inference. Vercel was building `/` as DYNAMIC while
 * this repo built it static, which silently made it uncacheable at the edge and
 * cost ~800-4700ms of TTFB before anyone noticed. This page reads no cookies, no
 * headers and no searchParams, so it declares that rather than hoping the builder
 * infers it. ISR still applies via `revalidate` in app/layout.tsx.
 */
export const dynamic = "force-static";

/**
 * A Learning Academy™ lesson. See `docs/DOWNLOAD_HUB_RFC.md` §4.
 *
 * Fully static: `generateStaticParams` + `dynamicParams = false`, so an unknown
 * slug 404s at the edge rather than rendering.
 */

export function generateStaticParams() {
  return LESSON_SLUGS.map((slug) => ({ slug }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const lesson = getLesson(slug);
  if (!lesson) return {};
  return {
    title: lesson.title,
    description: lesson.description,
    alternates: { canonical: `/learn/${lesson.slug}` },
    openGraph: { type: "article", title: lesson.title, description: lesson.description },
    twitter: { card: "summary_large_image", title: lesson.title, description: lesson.description },
  };
}

export default async function LessonPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const lesson = getLesson(slug);
  if (!lesson) notFound();

  const related = relatedLessons(slug);
  // Two downloader pages, chosen deterministically from the slug so the link graph
  // is stable between builds rather than reshuffling and looking like churn.
  const primaries = getPrimaryPages();
  const offset = slug.length % Math.max(primaries.length, 1);
  const tools = [primaries[offset], primaries[(offset + 1) % primaries.length]].filter(Boolean);

  const allSteps = lesson.sections.flatMap((s) => s.steps ?? []);

  const graph: unknown[] = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: lesson.title,
      description: lesson.description,
      author: { "@type": "Organization", name: "Frenz" },
      publisher: { "@type": "Organization", name: "Frenz" },
      mainEntityOfPage: `${siteUrl}/learn/${lesson.slug}`,
    },
  ];

  // Only emit HowTo when the lesson genuinely has ordered steps — structured data
  // that misdescribes the page is a liability, not a bonus.
  if (allSteps.length > 0) {
    graph.push({
      "@context": "https://schema.org",
      "@type": "HowTo",
      name: lesson.title,
      description: lesson.description,
      step: allSteps.map((s, i) => ({
        "@type": "HowToStep",
        position: i + 1,
        name: s.title,
        text: s.text,
      })),
    });
  }

  if (lesson.faqs.length > 0) {
    graph.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: lesson.faqs.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    });
  }

  return (
    <>
      {graph.map((node, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLd(node) }}
        />
      ))}
      <SiteHeader />
      <main className="container max-w-3xl pb-24 pt-28 sm:pt-32">
        <Link
          href="/learn"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Learning Academy
        </Link>

        <header className="mt-6">
          <span className="text-xs font-medium text-muted-foreground">
            {lesson.minutes} min read
          </span>
          <h1 className="mt-2 text-3xl font-extrabold tracking-[-0.02em] sm:text-4xl sm:leading-[1.1]">
            {lesson.title}
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">{lesson.intro}</p>
        </header>

        <article className="mt-10 space-y-10">
          {lesson.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="mb-3 text-xl font-semibold tracking-[-0.01em] sm:text-2xl">
                {section.heading}
              </h2>
              {section.body.map((p) => (
                <p key={p.slice(0, 24)} className="mb-4 leading-relaxed text-muted-foreground">
                  {p}
                </p>
              ))}
              {section.steps ? (
                <ol className="mt-5 space-y-4">
                  {section.steps.map((step, i) => (
                    <li key={step.title} className="flex gap-4">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {i + 1}
                      </span>
                      <div>
                        <p className="font-medium">{step.title}</p>
                        <p className="mt-1 leading-relaxed text-muted-foreground">{step.text}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : null}
            </section>
          ))}

          {lesson.faqs.length > 0 ? (
            <section>
              <h2 className="mb-4 text-xl font-semibold tracking-[-0.01em] sm:text-2xl">
                Common questions
              </h2>
              <dl className="space-y-5">
                {lesson.faqs.map((f) => (
                  <div key={f.q} className="rounded-2xl border border-border/60 p-5">
                    <dt className="font-medium">{f.q}</dt>
                    <dd className="mt-2 leading-relaxed text-muted-foreground">{f.a}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}
        </article>

        {related.length > 0 ? (
          <section className="mt-14">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
              Keep reading
            </h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {related.map((l) => (
                <li key={l.slug}>
                  <Link
                    href={`/learn/${l.slug}`}
                    className="group flex h-full flex-col rounded-2xl border border-border/60 p-4 transition-colors hover:border-border hover:bg-secondary/50"
                  >
                    <span className="font-medium group-hover:text-primary">{l.title}</span>
                    <span className="mt-1.5 text-sm text-muted-foreground">{l.description}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {tools.length > 0 ? (
          <section className="mt-10">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
              Try it
            </h2>
            <ul className="mt-4 space-y-2">
              {tools.map((tool) => (
                <li key={tool!.slug}>
                  <Link
                    href={`/${tool!.slug}`}
                    className="group flex items-center justify-between rounded-2xl border border-border/60 px-5 py-4 transition-colors hover:border-border hover:bg-secondary/50"
                  >
                    <span className="font-medium">Open the {tool!.brand} downloader</span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
      <SiteFooter />
    </>
  );
}
