import * as Icons from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { articleHref, articlesInSection } from "@/lib/support/articles";
import { SECTIONS } from "@/lib/support/sections";
import { HELP_SECTIONS } from "@/lib/support/types";
import { jsonLd } from "@/lib/seo/json-ld";
import { SITE_URL as siteUrl } from "@/lib/site";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Help Center — getting started and troubleshooting",
  description:
    "How to save your first video, what an account adds, how to install Frenzsave on your phone, and what to do when a link will not download.",
  alternates: { canonical: "/help" },
};

/**
 * Help Center.
 *
 * ── The same shape as the Trust Center, deliberately ──────────────────────────
 *
 * Sections are headings on one page and articles are the routes. Giving each
 * section its own landing page would produce routes carrying two or three
 * articles apiece — thin pages that dilute the corpus rather than organise it,
 * and thin content is an active negative on a site whose ~148 generated pages
 * already work hard not to look duplicated. If a section grows past roughly six
 * articles it will have earned a page of its own.
 *
 * ── Where this sits between the other surfaces ────────────────────────────────
 *
 * The Academy teaches subjects; the glossary defines words; this answers one
 * question at a time for someone who is mid-problem and does not want a course.
 * That distinction is why support articles are a separate type from lessons
 * rather than a lesson with a flag — see lib/support/types.ts.
 *
 * The three exits at the bottom exist because the honest failure mode of a help
 * centre is a visitor whose question is not here. Sending them to a human beats
 * making them page through articles that do not answer it.
 */
export default function HelpPage() {
  const sections = HELP_SECTIONS.map((id) => SECTIONS[id]).sort((a, b) => a.order - b.order);

  const collectionLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Frenzsave Help Center",
    description: metadata.description,
    url: `${siteUrl}/help`,
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(collectionLd) }} />
      <SiteHeader />
      <main>
        <section className="border-b border-border/60 pb-14 pt-28 sm:pt-32">
          <div className="container max-w-4xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-primary">
              Help Center
            </p>
            <h1 className="max-w-2xl text-balance text-[2.2rem] font-extrabold leading-[1.08] tracking-[-0.03em] sm:text-5xl">
              Answers, one question at a time
            </h1>
            <p className="mt-5 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">
              How to save your first video, what an account is actually for, and what to
              do when something does not work the way you expected.
            </p>
          </div>
        </section>

        <div className="container max-w-4xl py-14 sm:py-16">
          {sections.map((section) => {
            const articles = articlesInSection(section.id);
            if (articles.length === 0) return null;

            const Icon =
              (Icons[section.icon as keyof typeof Icons] as Icons.LucideIcon) ?? Icons.CircleHelp;

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

          {/* When the answer is not here. */}
          <section className="mt-16 border-t border-border/60 pt-10">
            <h2 className="text-lg font-semibold tracking-[-0.01em] sm:text-xl">
              Not what you were looking for?
            </h2>
            <ul className="mt-5 grid gap-3 sm:grid-cols-3">
              {[
                {
                  href: "/academy",
                  title: "Academy",
                  blurb: "Learn the subject properly rather than fix one thing.",
                },
                {
                  href: "/trust",
                  title: "Trust Center",
                  blurb: "Security, privacy, safety and what we will not claim.",
                },
                {
                  href: "/contact",
                  title: "Contact us",
                  blurb: "A real person, when the answer is not written down.",
                },
              ].map((exit) => (
                <li key={exit.href}>
                  <Link
                    href={exit.href}
                    className="group block h-full rounded-xl border border-border/70 bg-card p-5 transition hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span className="block font-medium group-hover:text-primary">{exit.title}</span>
                    <span className="mt-1.5 block text-sm leading-relaxed text-muted-foreground">
                      {exit.blurb}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
