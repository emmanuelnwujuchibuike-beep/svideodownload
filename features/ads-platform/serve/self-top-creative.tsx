"use client";

import type { EligibleAd, FormatRules } from "@/lib/ads-platform/eligibility";

import { SelfAdBanner } from "./self-ad-banner";

/**
 * The paid top banner INSIDE the existing top-banner container
 * (TopPageBannerAd / StickyTopAd own the frame, padding and caption — owner,
 * 2026-10-08: "it should use the existing top banner slot").
 *
 * The creative keeps its own 10:1 proportion (the TOP_BANNER format), up to a
 * 728 px leaderboard width — about 37 px tall on a phone, 73 px on desktop —
 * and the box is reserved by `aspect-ratio`, so its arrival moves nothing
 * inside the bar. Rotation stays local (SelfAdBanner).
 */
export function SelfTopCreative({ ads, rules, page }: { ads: readonly EligibleAd[]; rules: FormatRules | null; page: string }) {
  const first = ads[0];
  const ratio = first?.w && first?.h ? first.w / first.h : 10;
  return (
    <div className="w-full max-w-[728px]" style={{ aspectRatio: String(ratio) }}>
      <SelfAdBanner ads={ads} rules={rules} placement="global_top_banner" page={page} variant="strip" className="h-full rounded-md" />
    </div>
  );
}
