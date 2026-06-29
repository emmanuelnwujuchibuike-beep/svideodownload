import { CtaBanner } from "@/components/landing/cta-banner";
import { Faq } from "@/components/landing/faq";
import { FeatureCards } from "@/components/landing/feature-cards";
import { Hero } from "@/components/landing/hero";
import { LatestNews } from "@/components/landing/latest-news";
import { MeetNewPeople } from "@/components/landing/meet-people";
import { PlatformShowcase } from "@/components/landing/platform-showcase";
import { StatsCounter } from "@/components/landing/stats-counter";
import { Testimonials } from "@/components/landing/testimonials";
import { TrendingToday } from "@/components/landing/trending-today";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { RecommendedTools } from "@/components/monetization/recommended-tools";
import { DownloaderLinks } from "@/components/seo/downloader-links";
import { AdSlot } from "@/features/monetization/ad-slot";

export default function HomePage() {
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
        <MeetNewPeople />
        <TrendingToday />
        <LatestNews />

        {/* Stats band */}
        <div className="container max-w-6xl py-6">
          <StatsCounter />
        </div>

        <Testimonials />

        {/* Admin-managed recommended tools (renders nothing when empty) */}
        <RecommendedTools
          placement="homepage"
          title="Recommended tools"
          className="container max-w-5xl py-8"
        />

        <DownloaderLinks heading="Popular video downloaders" />
        <CtaBanner />
        <Faq />
      </main>
      <SiteFooter />
    </>
  );
}
