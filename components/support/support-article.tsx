import { ExternalLink } from "lucide-react";
import Link from "next/link";

import { PersonalItemControls } from "@/features/personal/item-controls";
import { articleHref, relatedArticles } from "@/lib/support/articles";
import { centreOf, sectionMeta } from "@/lib/support/sections";
import type { SupportArticle } from "@/lib/support/types";

/**
 * One article, rendered identically wherever it lives.
 *
 * ── Why this is shared and not copied ─────────────────────────────────────────
 *
 * The Help Center and the Trust Center are two views over one corpus, so an
 * article has one presentation. Copying this body into a second route would have
 * been the faster edit and the worse outcome: `related` crosses freely between
 * the centres (a question about what is visible to whom is a help question and a
 * privacy question), so the two copies would immediately have needed the same
 * fixes and would just as immediately have stopped receiving them.
 *
 * ── The summary is not decoration ─────────────────────────────────────────────
 *
 * Every article opens with its plain-language summary, and the type makes that
 * field required. Support content is exactly where people skim and then act on a
 * half-understanding — someone asking whether a private video can be downloaded
 * should get the answer in the first two lines, not the fourth section.
 *
 * ── Explaining is not governing ───────────────────────────────────────────────
 *
 * Where an article summarises a formal policy it links out to it, prominently
 * rather than in a footnote. The plain-language version is a reading aid; the
 * policy remains authoritative, and letting a summary quietly stand in for the
 * document would be its own kind of dishonesty.
 */
export function SupportArticleBody({ article }: { article: SupportArticle }) {
  const section = sectionMeta(article.section);
  const centre = centreOf(article.section);
  const related = relatedArticles(article.slug);

  return (
    <article className="container max-w-2xl pb-16 pt-[calc(var(--frenz-safe-top)+7rem)] sm:pt-[calc(var(--frenz-safe-top)+8rem)]">
      <nav aria-label="Breadcrumb" className="mb-6">
        <ol className="flex items-center gap-2 text-sm text-muted-foreground">
          <li>
            <Link href={centre.href} className="transition hover:text-foreground">
              {centre.name}
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
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">In short</h2>
        <p className="mt-2 text-[0.95rem] leading-relaxed">{article.summary}</p>
      </div>

      {/*
        The personal layer. Mounted here rather than in each route so both
        centres get it from one place, and as a client island so /help and
        /trust stay statically prerendered.
      */}
      <PersonalItemControls kind="article" slug={article.slug} className="mt-6" />

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
            <h2 className="text-lg font-semibold tracking-[-0.01em] sm:text-xl">{block.heading}</h2>
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
          <h2 className="text-lg font-semibold tracking-[-0.01em] sm:text-xl">Common questions</h2>
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
              /*
                `articleHref`, not a hardcoded prefix — a related article may live
                in the other centre, and half of them do.
              */
              <li key={r.slug}>
                <Link
                  href={articleHref(r)}
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
  );
}

/**
 * The JSON-LD an article page emits: the article itself, its breadcrumb, and its
 * FAQs where it has them.
 *
 * Built here rather than in each route so the two centres cannot emit subtly
 * different structured data for identically-shaped content — and so `url` is
 * always the canonical one `articleHref` decided.
 */
export function supportArticleJsonLd(article: SupportArticle, siteUrl: string) {
  const centre = centreOf(article.section);
  const url = `${siteUrl}${articleHref(article)}`;

  const docs: Record<string, unknown>[] = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: article.title,
      description: article.description,
      url,
      publisher: { "@type": "Organization", name: "Frenzsave", url: siteUrl },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: centre.name, item: `${siteUrl}${centre.href}` },
        { "@type": "ListItem", position: 2, name: article.title, item: url },
      ],
    },
  ];

  if (article.faqs?.length) {
    docs.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: article.faqs.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    });
  }

  return docs;
}
