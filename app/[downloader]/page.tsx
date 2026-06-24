import {
  ChevronDown,
  Laptop,
  Monitor,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Zap,
} from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { RelatedLinks } from "@/components/seo/related-links";
import { Downloader } from "@/features/downloader/downloader";
import { BRAND_ICONS } from "@/lib/platform-icons";
import { PLATFORMS } from "@/lib/platforms";
import { getSeoPage, howToSteps, SEO_SLUGS } from "@/lib/seo/seo-pages";
import { SITE_URL as siteUrl } from "@/lib/site";

export function generateStaticParams() {
  return SEO_SLUGS.map((downloader) => ({ downloader }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ downloader: string }>;
}): Promise<Metadata> {
  const { downloader } = await params;
  const page = getSeoPage(downloader);
  if (!page) return {};

  const url = `${siteUrl}/${page.slug}`;
  return {
    title: page.title,
    description: page.description,
    keywords: [page.primaryKeyword, ...page.secondaryKeywords],
    alternates: { canonical: `/${page.slug}` },
    openGraph: {
      type: "website",
      url,
      siteName: "SVideoDownload",
      title: page.title,
      description: page.description,
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description: page.description,
    },
    robots: { index: true, follow: true },
  };
}

export default async function DownloaderPage({
  params,
}: {
  params: Promise<{ downloader: string }>;
}) {
  const { downloader } = await params;
  const page = getSeoPage(downloader);
  if (!page) notFound();

  const platform = PLATFORMS[page.platformId];
  const Icon = BRAND_ICONS[page.platformId];
  const steps = howToSteps(page.brand, page.thing);
  const url = `${siteUrl}/${page.slug}`;

  const softwareLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: page.title,
    applicationCategory: "MultimediaApplication",
    operatingSystem: "iOS, Android, Windows, macOS, Linux",
    url,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: "4.9",
      ratingCount: "18420",
    },
    description: page.description,
  };
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: page.faqs.map((ff) => ({
      "@type": "Question",
      name: ff.q,
      acceptedAnswer: { "@type": "Answer", text: ff.a },
    })),
  };
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
      { "@type": "ListItem", position: 2, name: page.brand, item: url },
    ],
  };
  const howToLd = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: `How to download ${page.brand} ${page.thing}`,
    step: steps.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.title,
      text: s.text,
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([softwareLd, faqLd, breadcrumbLd, howToLd]),
        }}
      />
      <SiteHeader />
      <main>
        {/* Hero + tool */}
        <section className="relative overflow-hidden pb-16 pt-28 sm:pt-36">
          {/* Primary blue glow */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-[-12%] -z-10 h-[400px] w-[720px] -translate-x-1/2 rounded-full bg-gradient-to-tr from-blue-500/25 via-sky-500/16 to-cyan-400/18 blur-[85px]"
          />
          {/* Gold accent — top right */}
          <div
            aria-hidden
            className="pointer-events-none absolute right-[4%] top-[5%] -z-10 h-[220px] w-[320px] rounded-full bg-gradient-to-bl from-amber-500/14 to-transparent blur-[70px]"
          />
          {/* Cyan accent — bottom left */}
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-0 left-[5%] -z-10 h-[160px] w-[260px] rounded-full bg-gradient-to-tr from-cyan-500/12 to-transparent blur-[60px]"
          />
          <div className="container flex flex-col items-center text-center">
            <span
              className={`mb-6 inline-flex items-center gap-2 rounded-full bg-gradient-to-br ${platform.accent} px-4 py-1.5 text-sm font-semibold text-white shadow-soft`}
            >
              {Icon ? <Icon className="h-4 w-4" /> : null}
              {page.brand} downloader
            </span>
            <h1 className="max-w-3xl text-balance text-[2.2rem] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-5xl lg:text-6xl">
              {page.h1}
            </h1>
            <p className="mt-5 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground">
              {page.tagline}
            </p>

            <div className="mt-10 w-full max-w-2xl scroll-mt-24" id="download">
              <Downloader />
            </div>

            <p className="mt-5 text-sm text-muted-foreground">
              Free · No watermark · No login · Works on iPhone, Android & PC
            </p>
          </div>
        </section>

        {/* How it works */}
        <section className="border-t border-border/60 py-16 sm:py-20">
          <div className="container max-w-5xl">
            <h2 className="mb-10 text-center text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
              How to download {page.brand} {page.thing}
            </h2>
            <ol className="grid gap-5 sm:grid-cols-3">
              {steps.map((s, i) => (
                <li
                  key={s.title}
                  className="rounded-2xl border border-border bg-card p-6 shadow-soft"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                    {i + 1}
                  </span>
                  <h3 className="mt-4 font-semibold">{s.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {s.text}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* SEO content + benefits */}
        <section className="border-t border-border/60 py-16 sm:py-20">
          <div className="container grid max-w-5xl gap-12 lg:grid-cols-[1.3fr_1fr]">
            <div className="space-y-4">
              <h2 className="text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
                The free {page.primaryKeyword} that just works
              </h2>
              {page.about.map((p) => (
                <p key={p.slice(0, 28)} className="leading-relaxed text-muted-foreground">
                  {p}
                </p>
              ))}

              <div className="!mt-8 grid gap-4 rounded-2xl border border-border bg-card p-6 shadow-soft sm:grid-cols-2">
                <Compat icon={Smartphone} label="iPhone & iPad" />
                <Compat icon={Smartphone} label="Android phones" />
                <Compat icon={Monitor} label="Windows PC" />
                <Compat icon={Laptop} label="Mac & Linux" />
              </div>
            </div>

            <div className="space-y-3">
              {page.benefits.map((b) => (
                <div
                  key={b.title}
                  className="rounded-2xl border border-border bg-card p-5 shadow-soft"
                >
                  <h3 className="flex items-center gap-2 font-semibold">
                    <Zap className="h-4 w-4 text-primary" /> {b.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {b.text}
                  </p>
                </div>
              ))}
              <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
                <h3 className="flex items-center gap-2 font-semibold">
                  <ShieldCheck className="h-4 w-4 text-primary" /> Safe & private
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  No account to hack, no files stored on our servers, and every
                  transfer is encrypted. We only download public content you have
                  the right to save.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="border-t border-border/60 py-16 sm:py-20">
          <div className="container max-w-3xl">
            <div className="mb-10 text-center">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-3 py-1 text-xs font-medium text-muted-foreground">
                <Sparkles className="h-3 w-3" /> FAQ
              </span>
              <h2 className="mt-4 text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
                {page.brand} downloader — questions
              </h2>
            </div>
            <div className="space-y-3">
              {page.faqs.map((ff) => (
                <details
                  key={ff.q}
                  className="group rounded-2xl border border-border bg-card p-5 shadow-soft open:shadow-card sm:p-6"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-medium [&::-webkit-details-marker]:hidden">
                    {ff.q}
                    <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-300 group-open:rotate-180" />
                  </summary>
                  <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
                    {ff.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <RelatedLinks slug={page.slug} brand={page.brand} />
      </main>
      <SiteFooter />
    </>
  );
}

function Compat({
  icon: Icon,
  label,
}: {
  icon: typeof Smartphone;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2.5 text-sm">
      <Icon className="h-4 w-4 text-primary" />
      <span className="font-medium">{label}</span>
    </div>
  );
}
