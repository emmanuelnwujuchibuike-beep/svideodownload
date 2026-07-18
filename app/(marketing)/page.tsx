import { Suspense } from "react";

import { CreatorsSection } from "@/components/landing/creators-section";
import { CtaBanner } from "@/components/landing/cta-banner";
import { Faq } from "@/components/landing/faq";
import { Hero } from "@/components/landing/hero";
import { ProductGrid } from "@/components/landing/product-grid";
import { MeetNewPeople } from "@/components/landing/meet-people";
import { PlatformShowcase } from "@/components/landing/platform-showcase";
import { StatsCounter } from "@/components/landing/stats-counter";
import { TrendingToday } from "@/components/landing/trending-today";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { RecommendedTools } from "@/components/monetization/recommended-tools";
import { DownloaderLinks } from "@/components/seo/downloader-links";
import { productJsonLd } from "@/lib/content/genome/queries";
import { jsonLd } from "@/lib/seo/json-ld";
import { SITE_URL } from "@/lib/site";
import { AdScripts } from "@/features/monetization/ad-scripts";
import { AdSlot } from "@/features/monetization/ad-slot";
import { StickyBottomAd } from "@/features/monetization/sticky-bottom-ad";

/**
 * The marketing landing page — the first page a new visitor ever loads, and the
 * one the 2-second budget matters most on (docs/FEATURE_21_LANDING.md §4).
 *
 * This page is deliberately STATIC. It touches no dynamic API: no `cookies()`,
 * no `searchParams`, no per-visitor data. Either one would opt the whole route
 * out of static generation and make every cold visitor wait on an origin render
 * in cdg1 (Paris) — from an Africa-primary audience — instead of hitting a CDN.
 *
 * Two things used to force that, and both moved rather than disappeared:
 *  - the signed-in → /home redirect now runs in middleware.ts, at the edge;
 *  - the Share Target hand-off is read on the client by SharedLinkDownloader.
 *
 * The auth-dependent chrome never needed the server: SiteHeader is a client
 * component resolving the user via useUser(). Keep it that way — adding a
 * server auth read here silently un-statics the page again.
 *
 * The Suspense'd sections below are data-backed and stream in behind the hero,
 * so the shell paints immediately rather than blocking the first byte on their
 * DB queries.
 */
// Static, but not frozen: ISR regenerates this document so Trending stays
// current without any visitor ever waiting on a DB read. The cadence is set by
// `export const revalidate = 60` in app/layout.tsx — Next uses the LOWEST
// revalidate in the segment tree, so a larger value declared here would be
// silently ignored. Change it there, not here.
export default function HomePage() {
  return (
    <>
      {/*
        Product entities, emitted from the Product Genome so the machine-readable
        description and the human-readable copy cannot drift — they are one record.
        Only CLAIMABLE products appear: `productJsonLd` filters on veracity, so an
        unbuilt product can never be published as a schema.org entity. Emitted here
        on the ecosystem pillar page rather than in the root layout, which would
        ship these bytes on every signed-in app page for no benefit.
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd({ "@context": "https://schema.org", "@graph": productJsonLd(SITE_URL) }),
        }}
      />
      {/*
        The landing page is committed to the mockup's dark treatment
        (`public/main landing page.jpg`), so `dark` is scoped to this page rather
        than left to the visitor's theme. Every section below already ships dark
        variants, so this switches tokens rather than overriding colours.

        Scoped with a plain class — NO transform, NO `will-change`. Either would
        make this element a containing block and break the `position: fixed`
        descendants inside it (the header, its portalled mobile menu, and the
        sticky bottom ad), which is the exact failure removed in 135ed36.

        The rest of the site stays theme-aware; only `/` is pinned.
      */}
      <div className="dark bg-[#050816] text-white">
        <SiteHeader />
        <main>
        <Hero />
        {/* Rendered from the Product Genome — see components/landing/product-grid.tsx */}
        <ProductGrid />

        {/* Ad slot — unchanged zone, placed in the new flow */}
        <div className="container max-w-5xl py-2">
          <AdSlot zone="homepage_top" />
        </div>

        <PlatformShowcase />

        {/* Data-backed sections stream in behind the hero so the page paints
            instantly instead of blocking the first byte on their DB queries. */}
        <Suspense fallback={<section className="min-h-[280px]" />}>
          <MeetNewPeople />
        </Suspense>
        <Suspense fallback={<section className="min-h-[280px]" />}>
          <TrendingToday />
        </Suspense>

        {/* Stats band */}
        <StatsCounter />

        {/* Admin-managed recommended tools (renders nothing when empty) */}
        <Suspense fallback={null}>
          <RecommendedTools
            placement="homepage"
            title="Recommended tools"
            className="container max-w-5xl py-8"
          />
        </Suspense>

        {/* "Built for Creators" — benefit checklist + rewards card, per the mockup. */}
        <CreatorsSection />

        <CtaBanner />

        {/* SEO link surface */}
        <DownloaderLinks heading="Popular video downloaders" />
          <Faq />
        </main>
        <SiteFooter />
      </div>
      {/* Ads live only here on the marketing landing page. */}
      <StickyBottomAd />
      <AdScripts />
    </>
  );
}
