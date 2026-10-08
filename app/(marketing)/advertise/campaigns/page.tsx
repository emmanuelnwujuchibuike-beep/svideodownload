import type { Metadata } from "next";
import { Suspense } from "react";

import { SiteHeader } from "@/components/layout/site-header";
import { MyCampaigns, Skeleton } from "@/features/ads-platform/my-campaigns";

/*
  Static: the dashboard is a client island that reads Postgres directly with
  the member's own session (RLS). A campaign opens in place (?c=<id>), so no
  page here is server-rendered per visitor and no function runs to show it.
*/
export const dynamic = "force-static";

export const metadata: Metadata = { title: "Advertiser dashboard — Frenzsave Ads", robots: { index: false, follow: false } };

export default function MyCampaignsPage() {
  return (
    <>
      <SiteHeader />
      <main className="bg-background">
        <div className="mx-auto w-full max-w-3xl px-4 pb-28 pt-[calc(var(--frenz-safe-top)+5rem)] sm:px-6 sm:pt-[calc(var(--frenz-safe-top)+6.5rem)]">
          <h1 className="font-brand text-[1.6rem] font-bold tracking-[-0.03em]">Your ads</h1>
          <p className="mt-1 text-[13.5px] text-muted-foreground">Campaigns, performance and payments.</p>
          <div className="mt-5">
            <Suspense fallback={<Skeleton />}>
              <MyCampaigns />
            </Suspense>
          </div>
        </div>
      </main>
    </>
  );
}
