import type { Metadata } from "next";

import { ProfileBottomNav, ProfileSidebar, ProfileTopbar } from "@/components/profile/dashboard/chrome";
import { ProfileMobileHeader } from "@/components/profile/dashboard/mobile-header";
import { ProfileHeaderCard } from "@/components/profile/dashboard/header-card";
import { Achievements, ProductsTools, RecentPosts } from "@/components/profile/dashboard/modules";
import { CompletionCard, EarningsCard, StatsRow, TopPerformerCard } from "@/components/profile/dashboard/overview";
import { MyWallet, RecentTransactions, WhoToFollow } from "@/components/profile/dashboard/finance";
import { Toaster } from "@/features/ui/toast";

/**
 * The signed-in profile DASHBOARD (owner: "the restructure of the main profile
 * page in signed in"). A faithful build of `public/profile.jpg` (desktop) and
 * `public/profilemobile.jpg` (mobile) with its own app chrome — left sidebar +
 * top bar on desktop, top bar + a real slide-in menu + bottom nav on mobile.
 *
 * This is DISTINCT from the landing `/profile` doorway (which stays a plain
 * sign-in card) — the signed-in dashboard must never appear on the landing.
 *
 * Display-first: the figures are the design's illustrative sample data; real
 * profile/wallet/earnings data + auth-gating land in later passes. Only features
 * that aren't built yet (marketplace, rewards, wallet actions, profile wallpaper,
 * …) announce "coming soon"; everything with a real route navigates.
 *
 * Static (no request data) and noindex (it's a placeholder, not public content).
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "My Profile",
  description: "Your Frenz profile — wallet, earnings, rewards, achievements and creator tools in one place.",
  robots: { index: false, follow: false },
};

export default function MyProfilePage() {
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
