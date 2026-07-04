import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { CtaBanner } from "@/components/landing/cta-banner";
import { Faq } from "@/components/landing/faq";
import { FeatureCards } from "@/components/landing/feature-cards";
import { Hero } from "@/components/landing/hero";
import { LatestNews } from "@/components/landing/latest-news";
import { MeetNewPeople } from "@/components/landing/meet-people";
import { PlatformShowcase } from "@/components/landing/platform-showcase";
import { StatsCounter } from "@/components/landing/stats-counter";
import { TrendingToday } from "@/components/landing/trending-today";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { RecommendedTools } from "@/components/monetization/recommended-tools";
import { DownloaderLinks } from "@/components/seo/downloader-links";
import { AdScripts } from "@/features/monetization/ad-scripts";
import { AdSlot } from "@/features/monetization/ad-slot";
import { StickyBottomAd } from "@/features/monetization/sticky-bottom-ad";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  // Signed-in users get the app dashboard, not the marketing landing page.
  // Only pay for the getUser() auth round-trip when a session cookie exists —
  // brand-new visitors skip it entirely and the landing renders immediately.
  const jar = await cookies();
  const maybeSignedIn = jar.getAll().some((c) => c.name.includes("-auth-token"));
  let signedIn = false;
  if (maybeSignedIn) {
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      signedIn = !!user;
    } catch {
      /* anon → show landing */
    }
  }
  if (signedIn) redirect("/home"); // outside try/catch — redirect() throws by design

  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <FeatureCards />

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
        <Suspense fallback={<section className="min-h-[240px]" />}>
          <LatestNews />
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

        <CtaBanner />

        {/* SEO link surface */}
        <DownloaderLinks heading="Popular video downloaders" />
        <Faq />
      </main>
      <SiteFooter />
      {/* Ads live only here on the marketing landing page. */}
      <StickyBottomAd />
      <AdScripts />
    </>
  );
}
