import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { definedTermLd } from "@/lib/discovery/schema";
import { jsonLd } from "@/lib/seo/json-ld";
import { SITE_URL as siteUrl } from "@/lib/site";
import { relatedTerms, sortedGlossary } from "@/lib/support/glossary";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Glossary — the words this site uses",
  description:
    "Plain definitions for rendition, bitrate, generation loss, sidecar captions, passkeys and the rest of the jargon around saving and publishing video.",
  alternates: { canonical: "/glossary" },
};

/**
 * Glossary.
 *
 * ── One page, anchors not routes ──────────────────────────────────────────────
 *
 * Twelve definitions could be twelve routes. They should not be: a page holding
 * two sentences has nothing to rank for and dilutes the corpus, which is the thin
 * content problem the Discovery work exists to avoid. One page with `id` anchors
 * is linkable at the same granularity (`/glossary#bitrate`) while being a single
 * substantial document.
 *
 * ── Why DefinedTerm matters here ──────────────────────────────────────────────
 *
 * These emit as schema.org `DefinedTerm` entities. That is what tells a search
 * engine or AI crawler what this site is ABOUT rather than merely what it
 * mentions — the difference between being indexed and being understood. Emitted
 * through `definedTermLd` in the Schema Registry so every structured-data shape
 * has one home, and through `jsonLd()` rather than raw JSON.stringify.
 */
export default function GlossaryPage() {
  const terms = sortedGlossary();

  const graph = terms.map((term) =>
    definedTermLd({
      name: term.term,
      description: term.definition,
      url: `${siteUrl}/glossary#${term.slug}`,
    }),
  );

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(graph) }} />
      <SiteHeader />
      <main>
        <section className="border-b border-border/60 pb-12 pt-[calc(var(--frenz-safe-top)+7rem)] sm:pt-[calc(var(--frenz-safe-top)+8rem)]">
          <div className="container max-w-3xl">
            <h1 className="text-balance text-[2rem] font-extrabold leading-[1.1] tracking-[-0.03em] sm:text-4xl">
              Glossary
            </h1>
            <p className="mt-4 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">
              The words this site uses, in plain language. No definition here needs
              another definition to make sense of it.
            </p>
          </div>
        </section>

        <div className="container max-w-3xl py-12 sm:py-14">
          {/* A description list, because that is what this is — the semantics do
              the work for screen readers without any ARIA. */}
          <dl className="space-y-10">
            {terms.map((term) => {
              const related = relatedTerms(term.slug);

              return (
                <div
                  key={term.slug}
                  id={term.slug}
                  /* scroll-mt clears the fixed header when arriving at an anchor —
                     without it the term lands underneath the chrome. */
                  className="scroll-mt-28 border-b border-border/50 pb-10 last:border-0"
                >
                  <dt className="text-lg font-semibold tracking-[-0.01em]">{term.term}</dt>
                  <dd className="mt-2 leading-relaxed text-muted-foreground">
                    {term.definition}
                  </dd>

                  {related.length > 0 ? (
                    <dd className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <span className="text-muted-foreground">See also</span>
                      {related.map((r, i) => (
                        <span key={r.slug}>
                          <Link
                            href={`#${r.slug}`}
                            className="font-medium underline underline-offset-4 transition hover:text-primary"
                          >
                            {r.term}
                          </Link>
                          {i < related.length - 1 ? (
                            <span className="text-muted-foreground">,</span>
                          ) : null}
                        </span>
                      ))}
                    </dd>
                  ) : null}
                </div>
              );
            })}
          </dl>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
