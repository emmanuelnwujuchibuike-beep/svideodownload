import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { SUPPORT_ARTICLES, getArticle, relatedArticles } from "@/lib/support/articles";
import { sectionMeta } from "@/lib/support/sections";
import { jsonLd } from "@/lib/seo/json-ld";
import { SITE_URL as siteUrl } from "@/lib/site";

export const dynamic = "force-static";

export function generateStaticParams() {
  return SUPPORT_ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) return {};

  return {
    title: `${article.title} — Frenzsave Trust Center`,
    description: article.description,
    alternates: { canonical: `/trust/${article.slug}` },
  };
}

/**
 * A Trust Center article.
 *
 * ── The summary is not decoration ─────────────────────────────────────────────
 *
 * Every article opens with its plain-language summary, and the type makes that
 * field required. Trust content is exactly where people skim and then act on a
 * half-understanding — someone deciding whether deletion is reversible should get
 * the answer in the first two lines, not the fourth section. Making it structural
 * means no article can ship without one.
 *
 * ── Explaining is not governing ───────────────────────────────────────────────
 *
 * Where an article summarises a formal policy it links out to it, prominently
 * rather than in a footnote. The plain-language version is a reading aid; the
 * policy remains authoritative, and letting a summary quietly stand in for the
 * document would be its own kind of dishonesty.
 */
export default async function TrustArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) notFound();

  const section = sectionMeta(article.section);
  const url = `${siteUrl}/trust/${article.slug}`;
  const related = relatedArticles(article.slug);

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.description,
    url,
    publisher: { "@type": "Organization", name: "Frenzsave", url: siteUrl },
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Trust Center", item: `${siteUrl}/trust` },
      { "@type": "ListItem", position: 2, name: article.title, item: url },
    ],
  };

  const faqLd = article.faqs?.length
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: article.faqs.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      }
    : null;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(faqLd ? [articleLd, breadcrumbLd, faqLd] : [articleLd, breadcrumbLd]),
        }}
      />
      <SiteHeader />
      <main>
        <article className="container max-w-2xl pb-16 pt-28 sm:pt-32">
          <nav aria-label="Breadcrumb" className="mb-6">
            <ol className="flex items-center gap-2 text-sm text-muted-foreground">
              <li>
                <Link href="/trust" className="transition hover:text-foreground">
                  Trust Center
                </Link>
              </li>
              <li aria-hidden>/</li>
              <li aria-current="page" className="text-foreground">
                {section.name}
              </li>
            </ol>
          </nav>

          <h1 className="text-balance text-[1.9rem] font-extrabold leading-[1.12] tracking-[-0.03em] sm:text-4xl">
            {article.title}
          </h1>

          {/* The answer, before the explanation. */}
          <div className="mt-6 rounded-xl border border-primary/25 bg-primary/[0.06] p-5">
            <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
              In short
            </h2>
            <p className="mt-2 text-[0.95rem] leading-relaxed">{article.summary}</p>
          </div>

          {article.policyHref ? (
            <p className="mt-4 text-sm text-muted-foreground">
              This explains our{" "}
              <Link
                href={article.policyHref}
                className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4 transition hover:text-primary"
              >
                formal policy
                <ExternalLink aria-hidden className="h-3.5 w-3.5" />
              </Link>
              , which remains the authoritative version.
            </p>
          ) : null}

          <div className="mt-10 space-y-10">
            {article.blocks.map((block) => (
              <section key={block.heading}>
                <h2 className="text-lg font-semibold tracking-[-0.01em] sm:text-xl">
                  {block.heading}
                </h2>
                {block.body.map((paragraph) => (
                  <p key={paragraph} className="mt-3 leading-relaxed text-muted-foreground">
                    {paragraph}
                  </p>
                ))}
                {block.steps ? (
                  <ol className="mt-5 space-y-4">
                    {block.steps.map((step, i) => (
                      <li key={step.title} className="flex gap-4">
                        <span
                          aria-hidden
                          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold"
                        >
                          {i + 1}
                        </span>
                        <span>
                          <span className="block font-medium">{step.title}</span>
                          <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
                            {step.text}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </section>
            ))}
          </div>

          {article.faqs?.length ? (
            <section className="mt-12 border-t border-border/60 pt-10">
              <h2 className="text-lg font-semibold tracking-[-0.01em] sm:text-xl">
                Common questions
              </h2>
              <dl className="mt-5 space-y-6">
                {article.faqs.map((faq) => (
                  <div key={faq.q}>
                    <dt className="font-medium">{faq.q}</dt>
                    <dd className="mt-1.5 leading-relaxed text-muted-foreground">{faq.a}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          {related.length > 0 ? (
            <section className="mt-12 border-t border-border/60 pt-10">
              <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Related
              </h2>
              <ul className="mt-4 space-y-2">
                {related.map((r) => (
                  <li key={r.slug}>
                    <Link
                      href={`/trust/${r.slug}`}
                      className="font-medium underline underline-offset-4 transition hover:text-primary"
                    >
                      {r.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
