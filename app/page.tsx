import { Faq } from "@/components/landing/faq";
import { Features } from "@/components/landing/features";
import { FlagshipPlatforms } from "@/components/landing/flagship-platforms";
import { Hero } from "@/components/landing/hero";
import { PlatformShowcase } from "@/components/landing/platform-showcase";
import { TikTokFlagship } from "@/components/landing/tiktok-flagship";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { HistoryPanel } from "@/features/history/history-panel";

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <HistoryPanel />
        <FlagshipPlatforms />
        <TikTokFlagship />
        <PlatformShowcase />
        <Features />
        <Faq />
      </main>
      <SiteFooter />
    </>
  );
}
