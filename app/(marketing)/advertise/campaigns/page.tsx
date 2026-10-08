import type { Metadata } from "next";

import { SiteHeader } from "@/components/layout/site-header";
import { MyCampaigns } from "@/features/ads-platform/my-campaigns";

export const dynamic = "force-static";

export const metadata: Metadata = { title: "My campaigns — Frenzsave Ads", robots: { index: false, follow: false } };

export default function MyCampaignsPage() {
  return (
    <>
      <SiteHeader />
      <main className="bg-background">
        <div className="mx-auto w-full max-w-xl px-4 pb-28 pt-[calc(var(--frenz-safe-top)+5rem)] sm:pt-[calc(var(--frenz-safe-top)+6.5rem)]">
          <h1 className="font-brand text-[1.6rem] font-bold tracking-[-0.03em]">My campaigns</h1>
          <p className="mt-1 text-[13.5px] text-muted-foreground">Your ads, their payment and when they run.</p>
          <div className="mt-5">
            <MyCampaigns />
          </div>
        </div>
      </main>
    </>
  );
}
