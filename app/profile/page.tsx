import type { Metadata } from "next";

import {
  ProfileBottomNav,
  ProfileMobileHeader,
  ProfileSidebar,
  ProfileTopbar,
} from "@/components/profile/dashboard/chrome";
import { ProfileHeaderCard } from "@/components/profile/dashboard/header-card";
import { Achievements, ProductsTools, RecentPosts } from "@/components/profile/dashboard/modules";
import { CompletionCard, EarningsCard, StatsRow, TopPerformerCard } from "@/components/profile/dashboard/overview";
import { MyWallet, RecentTransactions, WhoToFollow } from "@/components/profile/dashboard/finance";
import { Toaster } from "@/features/ui/toast";

/**
 * The Frenz profile dashboard — a faithful build of `public/profile.jpg`
 * (desktop) and `public/profilemobile.jpg` (mobile). It carries its own app
 * chrome (left sidebar + top bar on desktop, top bar + bottom nav on mobile),
 * so it lives OUTSIDE the (marketing) group whose layout mounts a different
 * bottom nav + ad furniture.
 *
 * Built display-first (owner: "make the display premium and perfect"). The
 * figures are the design's illustrative sample data; real profile/wallet/earnings
 * data gets wired in later passes. Every feature that isn't built yet announces
 * "coming soon" on tap rather than dead-ending (see soon.tsx).
 *
 * Static: no request data is read, so it prerenders.
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Profile",
  description: "Your Frenz profile — wallet, earnings, rewards, achievements and creator tools in one place.",
};

export default function ProfilePage() {
  return (
    <div className="min-h-screen bg-muted dark:bg-background">
      <ProfileMobileHeader />

      <div className="flex">
        <ProfileSidebar />

        <div className="flex min-w-0 flex-1 flex-col">
          <ProfileTopbar />

          <main className="mx-auto w-full max-w-[1120px] px-3 pb-28 pt-[calc(var(--frenz-safe-top)+4.25rem)] sm:px-5 lg:px-8 lg:pb-10 lg:pt-6">
            <div className="space-y-4 lg:space-y-6">
              <ProfileHeaderCard />

              <StatsRow />

              {/* Earnings · Completion · Top Performer */}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-12 lg:gap-6">
                <EarningsCard className="col-span-1 lg:col-span-5" />
                <CompletionCard className="col-span-1 lg:col-span-4" />
                <TopPerformerCard className="col-span-2 lg:col-span-3" />
              </div>

              <ProductsTools />

              {/* Achievements · Recent Posts */}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5 lg:gap-6">
                <Achievements className="col-span-1 lg:col-span-2" />
                <RecentPosts className="col-span-1 lg:col-span-3" />
              </div>

              {/* Wallet · Transactions · Who to follow */}
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3 lg:gap-6">
                <MyWallet />
                <RecentTransactions />
                <WhoToFollow />
              </div>
            </div>
          </main>
        </div>
      </div>

      <ProfileBottomNav />
      <Toaster />
    </div>
  );
}
