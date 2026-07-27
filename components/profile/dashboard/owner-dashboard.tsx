import { ProfileHeaderCard, type ProfileHeaderProps } from "@/components/profile/dashboard/header-card";
import { Achievements, ProductsTools, RecentPosts } from "@/components/profile/dashboard/modules";
import { CompletionCard, EarningsCard, StatsRow, TopPerformerCard } from "@/components/profile/dashboard/overview";
import { MyWallet, RecentTransactions, WhoToFollow } from "@/components/profile/dashboard/finance";
import { Toaster } from "@/features/ui/toast";

/**
 * The signed-in profile DASHBOARD body — a faithful build of `public/profile.jpg`
 * / `public/profilemobile.jpg`. Rendered as the OWNER's own /u/[handle] view
 * (owner: "the restructure of the main profile page in signed in"), INSIDE the
 * app shell (app/u/layout.tsx already supplies the sidebar/top bar/bottom nav),
 * so this is content only — no chrome of its own.
 *
 * The header (name/handle/avatar/badges/counts/bio/joined) uses the viewer's REAL
 * profile. The feature cards (wallet, earnings, rewards, achievements, …) are the
 * design's illustrative content until their backends exist; unbuilt actions
 * announce "coming soon" on tap, everything built navigates to its real route.
 */
export function OwnerProfileDashboard(props: ProfileHeaderProps) {
  return (
    <div className="mx-auto w-full max-w-[1120px] px-3 sm:px-4 lg:px-6">
      <div className="space-y-4 lg:space-y-6">
        <ProfileHeaderCard {...props} />

        <StatsRow />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-12 lg:gap-6">
          <EarningsCard className="col-span-1 lg:col-span-5" />
          <CompletionCard className="col-span-1 lg:col-span-4" />
          <TopPerformerCard className="col-span-2 lg:col-span-3" />
        </div>

        <ProductsTools />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5 lg:gap-6">
          <Achievements className="col-span-1 lg:col-span-2" />
          <RecentPosts className="col-span-1 lg:col-span-3" />
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3 lg:gap-6">
          <MyWallet />
          <RecentTransactions />
          <WhoToFollow />
        </div>
      </div>
      <Toaster />
    </div>
  );
}
