import { ArrowRight, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { guideLabel, type Guide } from "@/lib/seo/guides";
import { jsonLd } from "@/lib/seo/json-ld";
import { SITE_URL } from "@/lib/site";

/**
 * One public guide (lib/seo/guides.ts), rendered on the server.
 *
 * 🔴 No client code of its own and no request on view: the page is static HTML.
 * Links into the tools (`/ai/**`, `/advertise/create`) are plain anchors with
 * `prefetch={false}` — a reader of an explainer never downloads a tool's
 * bundle until they choose to open it. The only client islands are the live
 * advertising price/format lists, passed in by the advertising route.
 */

const SECTION_NAME: Record<Guide["section"], { name: string; href: string }> = {
  "frenz-ai": { name: "Frenz AI", href: "/frenz-ai" },
  advertise: { name: "Advertise", href: "/advertise" },
};

/** Title, description, canonical and social cards — all from the guide's own fields. */
export function guideMetadata(g: Guide): Metadata {
  return {
    // `absolute`: the guide titles already carry the brand; the root template would double it
    title: { absolute: g.title },
    description: g.description,
    alternates: { canonical: g.path },
    openGraph: { type: g.article ? "article" : "website", title: g.title, description: g.description, url: g.path, ...(g.article ? { modifiedTime: g.updated } : {}) },
    twitter: { card: "summary_large_image", title: g.title, description: g.description },
  };
}

/** The breadcrumb trail: Home › section › page (the hub is its own section page). */
export function breadcrumbsOf(g: Guide): { name: string; href: string }[] {
  const section = SECTION_NAME[g.section];
  const trail = [{ name: "Home", href: "/" }, section];
  return g.path === section.href ? trail : [...trail, { name: g.h1, href: g.path }];
}

/** Structured data that mirrors only what the page visibly shows. */
export function guideJsonLd(g: Guide): object[] {
  const out: object[] = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: breadcrumbsOf(g).map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: `${SITE_URL}${c.href === "/" ? "" : c.href}` || SITE_URL })),
    },
  ];
  if (g.faqs.length) {
    out.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: g.faqs.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
    });
  }
  if (g.article) {
    out.push({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: g.h1,
      description: g.description,
      dateModified: g.updated,
      mainEntityOfPage: `${SITE_URL}${g.path}`,
      author: { "@type": "Organization", name: "Frenzsave" },
      publisher: { "@type": "Organization", name: "Frenzsave" },
    });
  }
  return out;
}

const isTool = (href: string) => href.startsWith("/ai") || href.startsWith("/advertise/create");

export function GuidePage({ guide: g, live, children }: { guide: Guide; live?: ReactNode; children?: ReactNode }) {
  const crumbs = breadcrumbsOf(g);
  return (
    <>
      <SiteHeader />
      <main className="bg-background">
        <article className="mx-auto w-full max-w-3xl px-4 pb-24 pt-[calc(var(--frenz-safe-top)+5.5rem)] sm:px-6 sm:pt-[calc(var(--frenz-safe-top)+7rem)]">
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-1 text-[12.5px] text-muted-foreground">
              {crumbs.map((c, i) => (
                <li key={c.href} className="inline-flex items-center gap-1">
                  {i > 0 ? <ChevronRight className="h-3.5 w-3.5" aria-hidden /> : null}
                  {i === crumbs.length - 1 ? (
                    <span aria-current="page" className="font-medium text-foreground/80">{c.name}</span>
                  ) : (
                    <Link href={c.href} className="hover:text-foreground">{c.name}</Link>
                  )}
                </li>
              ))}
            </ol>
          </nav>

          <h1 className="mt-4 font-brand text-[2rem] font-bold leading-[1.1] tracking-[-0.035em] sm:text-[2.5rem]">{g.h1}</h1>
          <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-foreground/80">{g.intro}</p>
          <div className="mt-6">
            <CtaLink href={g.cta.href} label={g.cta.label} />
          </div>

          {g.blocks.map((b) => (
            <section key={b.h2} className="mt-11">
              <h2 className="font-brand text-[1.35rem] font-bold tracking-[-0.03em]">{b.h2}</h2>
              {b.paragraphs?.map((p) => (
                <p key={p.slice(0, 40)} className="mt-3 text-[15px] leading-relaxed text-foreground/85">{p}</p>
              ))}
              {b.steps ? (
                <ol className="mt-4 space-y-2.5">
                  {b.steps.map((s, i) => (
                    <li key={s} className="flex gap-3 text-[15px] leading-relaxed">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[12px] font-bold tabular-nums text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200" aria-hidden>{i + 1}</span>
                      <span className="text-foreground/85">{s}</span>
                    </li>
                  ))}
                </ol>
              ) : null}
              {b.bullets ? (
                <ul className="mt-4 space-y-2">
                  {b.bullets.map((s) => (
                    <li key={s} className="flex gap-3 text-[15px] leading-relaxed text-foreground/85">
                      <span className="mt-[0.6rem] h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" aria-hidden />
                      {s}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}

          {live ? <div className="mt-11">{live}</div> : null}
          {children}

          {g.faqs.length ? (
            <section className="mt-12">
              <h2 className="font-brand text-[1.35rem] font-bold tracking-[-0.03em]">Questions people ask</h2>
              <div className="mt-4 divide-y divide-border/70 rounded-2xl bg-card ring-1 ring-inset ring-border/70">
                {g.faqs.map(({ q, a }) => (
                  <div key={q} className="px-4 py-4">
                    <h3 className="text-[15px] font-semibold">{q}</h3>
                    <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">{a}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {g.related.length ? (
            <section className="mt-12">
              <h2 className="font-brand text-[1.35rem] font-bold tracking-[-0.03em]">Related</h2>
              <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
                {g.related.map((href) => (
                  <li key={href}>
                    <Link href={href} className="flex min-h-[3.25rem] items-center justify-between gap-3 rounded-2xl bg-card px-4 py-3 text-[14.5px] font-semibold ring-1 ring-inset ring-border/70 transition hover:ring-indigo-300 dark:hover:ring-indigo-400/40">
                      {guideLabel(href)}
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="mt-12 rounded-2xl bg-gradient-to-br from-indigo-50 to-violet-50 p-5 ring-1 ring-inset ring-indigo-100 dark:from-indigo-500/10 dark:to-violet-500/10 dark:ring-indigo-400/20">
            <p className="text-[15px] font-semibold">Ready to start?</p>
            <div className="mt-3">
              <CtaLink href={g.cta.href} label={g.cta.label} />
            </div>
          </div>

          <p className="mt-8 text-[12px] text-muted-foreground">
            Last updated <time dateTime={g.updated}>{new Date(`${g.updated}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}</time>
          </p>
        </article>
        {guideJsonLd(g).map((d, i) => (
          <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(d) }} />
        ))}
      </main>
      <SiteFooter />
    </>
  );
}

function CtaLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      // a tool's bundle is fetched when the reader chooses it, never while they read
      prefetch={isTool(href) ? false : undefined}
      className="inline-flex min-h-[3rem] items-center gap-2 rounded-full bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 px-5 text-[15px] font-semibold text-white shadow-sm transition hover:opacity-95"
    >
      {label}
      <ArrowRight className="h-4 w-4" aria-hidden />
    </Link>
  );
}

/** A grid of guides, for the section hubs. */
export function GuideGrid({ guides }: { guides: Guide[] }) {
  return (
    <ul className="mt-4 grid gap-3 sm:grid-cols-2">
      {guides.map((g) => (
        <li key={g.path}>
          <Link href={g.path} className="block h-full rounded-2xl bg-card p-4 ring-1 ring-inset ring-border/70 transition hover:ring-indigo-300 dark:hover:ring-indigo-400/40">
            <span className="block text-[15px] font-semibold">{g.h1}</span>
            <span className="mt-1 block text-[13px] leading-snug text-muted-foreground">{g.description}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
