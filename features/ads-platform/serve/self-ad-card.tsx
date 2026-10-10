"use client";

import type { EligibleAd, FormatRules } from "@/lib/ads-platform/eligibility";
import { cn } from "@/lib/utils";

import { SelfAdBanner } from "./self-ad-banner";

/**
 * The paid card (CONTENT_BANNER, DOWNLOAD_RESULT_BANNER), laid out like the
 * advertiser's preview: the creative at its own ratio inside 320 × 500
 * (cardMediaBox, never cropped), then "Sponsored · sponsor", headline,
 * description and Visit. The box is reserved from the creative's stored size,
 * so the media arriving moves nothing. The row names it Sponsored, so the old
 * caption above the card is gone (it said the same thing twice).
 */
export function SelfAdCard({
  ads,
  rules,
  placement,
  page,
  className,
}: {
  ads: readonly EligibleAd[];
  rules: FormatRules | null;
  placement: string;
  page: string;
  className?: string;
}) {
  if (!ads.length) return null;
  return (
    <aside className={cn("mx-auto w-full max-w-[320px]", className)} aria-label="Sponsored">
      <SelfAdBanner ads={ads} rules={rules} placement={placement} page={page} variant="card" />
    </aside>
  );
}
