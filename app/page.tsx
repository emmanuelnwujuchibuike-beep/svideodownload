import { Faq } from "@/components/landing/faq";
import { Features } from "@/components/landing/features";
import { FlagshipPlatforms } from "@/components/landing/flagship-platforms";
import { Hero } from "@/components/landing/hero";
import { PlatformShowcase } from "@/components/landing/platform-showcase";
import { TikTokFlagship } from "@/components/landing/tiktok-flagship";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { RecommendedTools } from "@/components/monetization/recommended-tools";
import { DownloaderLinks } from "@/components/seo/downloader-links";
import { HistoryPanel } from "@/features/history/history-panel";
import { AdSlot } from "@/features/monetization/ad-slot";

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <div className="container max-w-5xl py-4">
          <AdSlot zone="homepage_top" />
        </div>
        <HistoryPanel />
        <FlagshipPlatforms />
        <TikTokFlagship />
        <PlatformShowcase />
        <Features />
        <RecommendedTools
          placement="homepage"
          title="Recommended tools we love"
          subtitle="Hand-picked hosting, VPN, AI and developer tools."
          className="container max-w-5xl py-8"
        />
        <DownloaderLinks heading="Popular video downloaders" />
        <Faq />
      </main>
      <SiteFooter />
    </>
  );
}
