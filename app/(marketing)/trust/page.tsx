import * as Icons from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { articleHref, articlesInSection } from "@/lib/support/articles";
import { SECTIONS } from "@/lib/support/sections";
import { TRUST_SECTIONS } from "@/lib/support/types";
import { jsonLd } from "@/lib/seo/json-ld";
import { SITE_URL as siteUrl } from "@/lib/site";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Trust Center — security, privacy, safety and transparency",
  description:
    "How Frenzsave protects your account, what is visible to whom, how reporting and appeals work, and what we will and will not claim.",
  alternates: { canonical: "/trust" },
};

/**
 * Trust Center™.
 *
 * ── Flat, not nested ──────────────────────────────────────────────────────────
 *
 * The brief describes ten named areas. Giving each its own landing page would
 * produce ten routes carrying two articles apiece — thin pages that dilute the
 * corpus rather than organise it, and thin content is an active SEO negative on a
 * site whose ~148 generated pages already have to work hard to avoid looking
 * duplicated.
 *
 * So sections are headings on one page and articles are the routes. If a section
 * grows past roughly six articles it will have earned its own page; until then
 * this is one strong page instead of five weak ones.
 *
 * ── What is deliberately absent ───────────────────────────────────────────────
 *
 * There is no status dashboard. The brief asks for one, and there is no uptime
 * monitoring behind it — a page reporting "all systems operational" without
 * measuring anything is a fabricated reassurance, and fabricated reassurance is
 * the one thing a trust centre must never ship. That absence is explained in the
 * transparency article rather than hidden.
 */
export default function TrustPage() {
  const sections = TRUST_SECTIONS.map((id) => SECTIONS[id]).sort((a, b) => a.order - b.order);

  const collectionLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Frenzsave Trust Center",
    description: metadata.description,
    url: `${siteUrl}/trust`,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(collectionLd) }}
      />
      <SiteHeader />
      <main>
        <section className="border-b border-border/60 pb-14 pt-28 sm:pt-32">
          <div className="container max-w-4xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-primary">
              Trust Center
            </p>
            <h1 className="max-w-2xl text-balance text-[2.2rem] font-extrabold leading-[1.08] tracking-[-0.03em] sm:text-5xl">
              How Frenzsave protects people
            </h1>
            <p className="mt-5 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">
              Plain-language explanations of account security, what is visible to whom,
              how reporting and appeals work, and what we will and will not claim about
              how this is run.
            </p>
          </div>
        </section>

        <div className="container max-w-4xl py-14 sm:py-16">
          {sections.map((section) => {
            const articles = articlesInSection(section.id);
            if (articles.length === 0) return null;

            const Icon =
              (Icons[section.icon as keyof typeof Icons] as Icons.LucideIcon) ?? Icons.Shield;

            return (
              <section key={section.id} className="mb-14 last:mb-0">
                <header className="mb-6 flex items-start gap-3">
                  <Icon aria-hidden className="mt-1 h-5 w-5 shrink-0 text-primary" />
                  <div>
                    <h2 className="text-xl font-semibold tracking-[-0.02em] sm:text-2xl">
                      {section.name}
                    </h2>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {section.blurb}
                    </p>
                  </div>
                </header>

                <ul className="space-y-3">
                  {articles.map((article) => (
                    <li key={article.slug}>
                      <Link
                        href={articleHref(article)}
                        className="group block rounded-xl border border-border/70 bg-card p-5 transition hover:border-primary/40 hover:shadow-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <h3 className="font-medium group-hover:text-primary">{article.title}</h3>
                        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                          {article.description}
                        </p>
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
