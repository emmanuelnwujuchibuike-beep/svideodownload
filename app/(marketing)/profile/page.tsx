import type { Metadata } from "next";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { AnonymousProfile } from "@/features/profile-landing/anonymous-profile";
import { getLandingSettings } from "@/lib/landing/settings";
import { cashOutLine, earnOpportunities } from "@/lib/profile-landing/earn";
import { listWallpapers } from "@/lib/wallpapers-server";

/*
  Static, refreshed the same way the rest of the landing is: the reward rules and
  the four wallpaper thumbnails are read through the service-role client (no
  cookies, so the page stays prerendered) and an admin save re-generates it. The
  layout's daily revalidate is the backstop. No request data, so a visitor costs
  nothing but the static file.
*/
export const dynamic = "force-static";
export const revalidate = 86400;

/*
  🔴 noindex (2026-08-16 SEO audit) is kept: /features already carries the
  indexable description of what Frenzsave does, and two pages saying the same
  thing would split it. This page is the signed-out Profile tab.
*/
export const metadata: Metadata = {
  title: "Profile",
  description: "Create, connect and earn on Frenzsave: Frenz AI, creator subscriptions, rewards, wallpapers, downloads and friends.",
  alternates: { canonical: "/profile" },
  robots: { index: false, follow: false },
};

/**
 * The landing "Profile" tab (bottom nav) for a signed-out visitor — now a
 * discovery page for Frenzsave instead of a single sign-in card (owner brief
 * 2026-10-11). The signed-in profile is still the member's own /u/[handle]
 * (owner, 2026-07-27: it must never appear here).
 */
export default async function ProfilePage() {
  const [settings, walls] = await Promise.all([getLandingSettings(), listWallpapers(null, 4).catch(() => [])]);
  const rewards = settings.frenzRewards;
  const sub = rewards.sub;
  return (
    <div className="bg-background text-foreground">
      <SiteHeader />
      <main className="container max-w-3xl pb-[calc(var(--frenz-bottom-nav)+2.5rem)] pt-[calc(var(--frenz-safe-top)+4.75rem)] sm:pt-[calc(var(--frenz-safe-top)+5.75rem)]">
        <AnonymousProfile
          earn={earnOpportunities(rewards)}
          cashOut={cashOutLine(rewards)}
          sub={{ live: sub.purchasesEnabled, purchaseFeePercent: sub.purchaseFeePercent, withdrawalFeePercent: sub.withdrawalFeePercent, requireQualification: sub.requireQualification, autoPayout: sub.autoPayout }}
          wallpapers={walls.slice(0, 4).map((w) => ({ id: w.id, title: w.name || "Wallpaper", thumbUrl: w.thumbUrl }))}
        />
      </main>
      <SiteFooter />
    </div>
  );
}
