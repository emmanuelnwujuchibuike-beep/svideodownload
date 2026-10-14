"use client";

import { usePathname } from "next/navigation";

import { useEntitlements } from "@/features/auth/use-entitlements";
import { isAdFreeRoute } from "@/lib/monetization/ad-free-routes";
import { planSeesAd } from "@/lib/monetization/plan-ads";

/**
 * Whether to show an ad to the current visitor.
 * Thin wrapper over `useEntitlements` so the whole app shares ONE cached
 * `/api/me` fetch (plan, ads, handle) instead of each hook fetching separately.
 *
 * `placement` (owner 2026-10-12): Pro still sees the download-result, History,
 * Feed and Reels ads; Business sees none — lib/monetization/plan-ads.ts. Without
 * a placement the answer is the plan's plain "ads on" (free only).
 */
export function useShowAds(placement?: string | null) {
  const { showAds, ready, plan } = useEntitlements();
  // 2026-10-14 (owner): no ad of any kind on the sign-in or profile pages (lib/monetization/ad-free-routes.ts)
  const pathname = usePathname();
  if (isAdFreeRoute(pathname)) return { showAds: false, ready };
  return { showAds: showAds || planSeesAd(plan, placement ?? null), ready };
}
