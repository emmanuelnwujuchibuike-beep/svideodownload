"use client";

import type { EligibleAd, FormatRules } from "@/lib/ads-platform/eligibility";
import { cn } from "@/lib/utils";

import { SelfAdBanner } from "./self-ad-banner";

/**
 * The 320×200 paid card (CONTENT_BANNER, DOWNLOAD_RESULT_BANNER) in the
 * product's own card language — the same "Sponsored" caption the network
 * surface uses, the sponsor named, a calm rounded frame. Never wider than
 * 320 px on a phone column and never stretched on desktop; the 320/200 box is
 * reserved by `aspect-ratio`, so the creative arriving moves nothing.
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
      <p className="mb-1.5 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
        Sponsored
      </p>
      <SelfAdBanner ads={ads} rules={rules} placement={placement} page={page} variant="card" />
    </aside>
  );
}
