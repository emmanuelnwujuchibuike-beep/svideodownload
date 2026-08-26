import { Suspense } from "react";

import { CtaBanner } from "@/components/landing/cta-banner";
import { Faq } from "@/components/landing/faq";
import { FeaturesGrid } from "@/components/landing/features-grid";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { ProductGrid } from "@/components/landing/product-grid";
import { PlatformShowcase } from "@/components/landing/platform-showcase";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { RecommendedTools } from "@/components/monetization/recommended-tools";
import { DownloaderLinks } from "@/components/seo/downloader-links";
import { productJsonLd } from "@/lib/content/genome/queries";
import { jsonLd } from "@/lib/seo/json-ld";
import { SITE_URL } from "@/lib/site";
import { AdSurface } from "@/features/monetization/ad-surface";

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
 *  - the Share Target hand-off is read on the client by HeroLinkDownloader
 *    (folded in 2026-08-16 when the second, duplicate paste tool that used to
 *    own this was removed — see the comment there).
 *
 * The auth-dependent chrome never needed the server: SiteHeader is a client
 * component resolving the user via useUser(). Keep it that way — adding a
 * server auth read here silently un-statics the page again.
 *
 * The Suspense'd sections below are data-backed and stream in behind the hero,
 * so the shell paints immediately rather than blocking the first byte on their
 * DB queries.
 */
/*
 * DECLARED static, not merely expected to be.
 *
 * This local build has always produced `○ /`. Vercel's build produces `ƒ /` —
 * confirmed in its build log — and a dynamically-rendered route is served
 * `Cache-Control: private, no-cache, no-store` with `x-vercel-cache: MISS`,
 * which is why `/` was the ONLY prerendered route not served from the CDN
 * (`/about`, `/learn` and every downloader page come back `PRERENDER`). That
 * cost a TTFB of 799-4752ms on the page the 2-second budget exists for.
 *
 * The divergence is not a missing env var — a local build with `.env.local`
 * removed entirely still yields `○`. Rather than keep guessing at what differs
 * inside Vercel's builder, this states the intent the file has always
 * documented: the page reads no cookies, no headers and no searchParams, so
 * there is nothing for dynamic rendering to do.
 *
 * If some descendant ever DOES reach for request data, `force-static` makes
 * that visible instead of silently un-caching the front door — which is the
 * failure mode we just spent a long time diagnosing.
 *
 * Still not frozen: ISR regenerates this document so Trending stays current
 * without any visitor waiting on a DB read. The cadence comes from
 * `export const revalidate = 60` in app/layout.tsx — Next uses the LOWEST
 * revalidate in the segment tree, so a larger value declared here would be
 * silently ignored. Change it there, not here.
 */
export const dynamic = "force-static";

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
        The landing page follows the VISITOR'S THEME — it is not pinned to dark.
        `public/main landing page.jpg` is the dark-theme design; the light theme
        gets its own treatment of the same composition (same layout, same effects,
        light ground and softened glows) rather than a forced dark page.

        Every landing section below styles both, so this wrapper only carries the
        theme tokens. Deliberately no `dark` class and no transform here: forcing
        the class would override the site toggle, and a transform would make this a
        containing block and break the `position: fixed` header, its portalled
        mobile menu, and the sticky ad (the failure removed in 135ed36).
      */}
      {/*
        🔴 REVERSED 2026-08-17 (owner: "change the landing page body theme from
        grey to white like the download page" → "the body, header, everything
        thats gray background to white"). The 2026-08-16 entry directly below
        is the decision this replaces — kept deliberately, in two passes, one
        day earlier. Left in place rather than deleted as a record that gray
        was tried on purpose, in case a future request asks for it back. The
        header's `topGradient` wash stays removed either way — that was never
        about the gray ground, and the owner was explicit it's /downloads-only.
      */}
      <div className="bg-background text-foreground">
        <SiteHeader landing />
        <main>
        <Hero />
        {/*
          Everything below the hero is skipped for layout and paint until it is
          scrolled near.

          MEASURED cause, not a guess: FCP on `/` lands around 1.1s while the
          hero H1 — the LCP element — paints at ~2.5s. Blocking webfonts barely
          moved it (2504ms vs 2588ms), so the gap is not the font; it is the
          main thread doing style and layout for a ten-section document (heavy
          hero effects, a full phone mockup) on a 4x-throttled CPU before it can
          paint the top of the page.

          `content-visibility: auto` lets the browser skip that work for
          offscreen subtrees entirely. `contain-intrinsic-size` supplies a
          placeholder height so the scrollbar and anchor links stay honest —
          without it the page would collapse and jump as sections realise their
          real size. Pure CSS: no JS, no visual change, and it degrades to
          today's behaviour on browsers that do not support it.
        */}
        {/*
          🔴 ONE wrapper with a 900px guess is a layout-shift machine (owner,
          2026-08-10: CLS measured at 0.684, up from 0.009).

          `content-visibility: auto` was applied to a SINGLE div wrapping every
          section below the hero — the mockup, the creators grid, the showcase,
          the tools, the CTA, the SEO links and the FAQ. `contain-intrinsic-size`
          told the browser that whole subtree was 900px tall. It is several
          thousand.

          So the document reported one height, and the moment the wrapper came
          near the viewport it rendered and grew by thousands of pixels. That is
          not a small correction, it is the page changing length underneath a
          scrolling finger, and CLS scores exactly that.

          The technique is right and is still used on the history page — but
          there it wraps ONE day section at a time, with `auto` remembering each
          real height after the first pass. Applied to ten heterogeneous
          sections at once, a single placeholder cannot be right for any of them.

          The wrapper is removed rather than re-tuned. Its stated purpose was to
          skip layout for the phone mockup, which no longer exists, so the cost
          it was compensating for is gone with it.
        */}
        <div>
        {/*
          🔴 The Downloads phone mockup is REMOVED (owner, 2026-08-10, with a
          screenshot of the section).

          It was the single most expensive thing below the hero: a full phone
          frame with its own shadow stack, a rendered Downloads screen inside
          it, and six feature cards — all of it decoration, none of it something
          a visitor can use. The comment above this block already named it as
          the reason the LCP element waited on style and layout for a ten-section
          document.

          Removing it takes the markup, its images and its share of the
          main-thread work out of the page entirely, which is worth more than
          the `content-visibility` wrapper that was compensating for it.
        */}

        {/*
          🔴 REMOVED 2026-08-23 — the "Premium Experience" panel and its 2×2
          image grid (owner: "remove premium experience section in the landing
          page and this four image grid section since the wallpaper page is the
          main image download page, so it improves the landing CLS, FCP and
          LCP").

          It was also, measurably, the landing's LCP element: a cold-start audit
          the same day (slow-4G + 4x CPU) found the first LCP candidate was the
          hero paragraph at 932ms, and LCP then REGRESSED to 1872ms waiting on
          the first tile of this grid — four `next/image` requests, a client
          island for the viewer, and a `min-h-[560px]` Suspense hole above the
          fold. Removing it deletes that regression outright rather than tuning
          it, and hands image browsing to /wallpapers, which is the surface
          built for it.

          `CreatorsSection` and `FeedGridGallery` are deleted with it, along
          with the admin Landing panel's feed-grid slot that fed them — an
          admin control whose output renders nowhere is exactly the dead
          affordance this codebase keeps having to remove.
        */}

        {/*
          🔴 REMOVED 2026-08-23 — the four-up stats band (owner).

          "12 Platforms supported" was real (derived from the registry), but it
          sat beside "4 Watermark-free sources" and "17 Features shipped" —
          numbers a visitor cannot check and that read as invented, which is
          exactly the pattern flagged in the standing no-fabricated-stats rule.
          A counter nobody can verify costs more trust than it buys, and the
          platform count is already stated honestly by PlatformShowcase below.
        */}

        {/* Everything you need — the six-feature grid. */}
        <FeaturesGrid />

        {/* How it works — 3 simple steps. */}
        <HowItWorks />

        {/* Ecosystem grid (Product Genome). */}
        <ProductGrid />

        {/*
          Ad slot — same zone, on the shared premium surface. Renders nothing until
          the slot confirms an ad.
        */}
        <div className="container max-w-5xl px-3 py-2">
          <AdSurface zone="homepage_top" maxWidth="max-w-3xl" />
        </div>

        <PlatformShowcase />

        {/* Admin-managed recommended tools (renders nothing when empty) */}
        <Suspense fallback={null}>
          <RecommendedTools
            placement="homepage"
            title="Recommended tools"
            className="container max-w-5xl px-3 py-8"
          />
        </Suspense>

        <CtaBanner />

        {/* SEO link surface */}
        <DownloaderLinks heading="Popular video downloaders" />
          <Faq />
        </div>
        </main>
        <SiteFooter />
      </div>
      {/*
        The bottom banner, the idle interstitial and the page-level script tag
        moved to `app/(marketing)/layout.tsx` so every page in the group carries
        them — including the ~148 generated downloader pages and the ones with
        no paste box. Rendering them here as well would mount two of each.
      */}
    </>
  );
}
