import { Features } from "@/components/landing/features";
import { Hero } from "@/components/landing/hero";
import { PlatformShowcase } from "@/components/landing/platform-showcase";
import { TikTokFlagship } from "@/components/landing/tiktok-flagship";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <TikTokFlagship />
        <PlatformShowcase />
        <Features />
      </main>
      <SiteFooter />
    </>
  );
}
