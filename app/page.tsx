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
import { sourceUrlSchema } from "@/lib/validation";
import { createClient } from "@/lib/supabase/server";

// manifest.ts `share_target` posts here as a GET with these params when
// someone shares a link into Frenz from another app (e.g. TikTok/Instagram's
// own "Share" sheet). Some senders put the link in `url`, others just dump it
// in `text` — check both. Reuses the same schema the download APIs already
// validate against, so a malformed/unsafe value is silently dropped rather
// than handed to the client unchecked.
function extractSharedUrl(params: { url?: string; text?: string }): string | undefined {
  for (const candidate of [params.url, params.text?.match(/https?:\/\/\S+/)?.[0]]) {
    if (candidate && sourceUrlSchema.safeParse(candidate).success) return candidate;
  }
  return undefined;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string; text?: string; title?: string }>;
}) {
  const sharedUrl = extractSharedUrl(await searchParams);

  // Signed-in users get the app dashboard, not the marketing landing page —
  // unless they just shared a link in, since the paste-a-link tool that
  // Share Target hands off to only lives on this landing page today.
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
  if (signedIn && !sharedUrl) redirect("/home"); // outside try/catch — redirect() throws by design

  return (
    <>
      <SiteHeader />
      <main>
        <Hero initialUrl={sharedUrl} />
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
