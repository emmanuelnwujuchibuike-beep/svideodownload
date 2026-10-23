"use client";

import type { EligibleAd, FormatRules } from "@/lib/ads-platform/eligibility";

import { SelfAdBanner } from "./self-ad-banner";

/**
 * The paid top banner INSIDE the existing top-banner container
 * (TopPageBannerAd / StickyTopAd own the frame, padding and caption — owner,
 * 2026-10-08: "it should use the existing top banner slot").
 *
 * The box is the CURRENT creative's own shape (owner, 2026-10-11: no crop, no
 * side bars), full width up to a 728 px leaderboard and at most 140 px tall
 * (TOP_STRIP_MAX). It starts from the stored w × h, so the arrival moves
 * nothing; it corrects to the media's real size once loaded, and a rotation
 * to a different shape resizes it (the bar republishes its height). Rotation
 * stays local (SelfAdBanner).
 */
export function SelfTopCreative({ ads, rules, page }: { ads: readonly EligibleAd[]; rules: FormatRules | null; page: string }) {
  return (
    <div className="flex w-full justify-center">
      <SelfAdBanner ads={ads} rules={rules} placement="global_top_banner" page={page} variant="strip" className="rounded-none" />
    </div>
  );
}
