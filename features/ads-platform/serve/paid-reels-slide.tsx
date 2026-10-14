"use client";

import { ChevronUp } from "lucide-react";
import { useEffect, useState } from "react";

import type { EligibleAd, FormatRules } from "@/lib/ads-platform/eligibility";
import { creativeFailed, nextFromPool, recordShown } from "@/lib/ads-platform/serving-state";

import { FullscreenVideoAd } from "./fullscreen-video-ad";
import { SelfAdCard } from "./self-ad-card";

/**
 * The PAID Reels slide (reels_banner). Its own lazily loaded module, so the serving helpers and
 * the full-screen layout reach the browser only when a paid slide is actually in the deck — the
 * feed that hosts the deck carries none of it (route weight budget).
 *
 * 🔴 A VIDEO fills the slide (owner, 2026-10-14: video ads full screen everywhere but the
 * download-result and feed cards). One creative per slide, chosen like every one-at-a-time
 * placement (never the one shown last); an image keeps the card, which picks its own. The deck's
 * tabs sit on top, so the layout drops its top row and labels the foot instead.
 */
export function PaidReelsSlide({ paid }: { paid: { ads: readonly EligibleAd[]; rules: FormatRules | null; page: string } }) {
  const [pick] = useState(() => nextFromPool("reels_banner", paid.ads.filter((a) => !creativeFailed(a.cr))));
  const [videoFailed, setVideoFailed] = useState(false);
  const fullVideo = pick?.mediaType === "video" && !videoFailed;
  useEffect(() => {
    if (fullVideo && pick) recordShown("reels_banner", pick.cr);
    // once, for the creative this slide shows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hint = (
    <p className="flex items-center justify-center gap-1.5 text-xs text-white/55">
      <ChevronUp className="h-3.5 w-3.5" aria-hidden /> Swipe up for the next reel
    </p>
  );

  if (fullVideo && pick) {
    return (
      <div data-ad-slot="reels_interstitial" data-ad-provider="frenzsave" className="relative h-full w-full bg-black">
        <FullscreenVideoAd ad={pick} placement="reels_banner" page={paid.page} header={false} onFail={() => setVideoFailed(true)} footer={<div className="mt-3">{hint}</div>} />
      </div>
    );
  }

  return (
    <div data-ad-slot="reels_interstitial" data-ad-provider="frenzsave" className="relative flex h-full w-full flex-col items-center justify-center gap-4 bg-black px-6">
      <SelfAdCard ads={paid.ads} rules={paid.rules} placement="reels_banner" page={paid.page} className="[&>p]:text-white/60" />
      {hint}
    </div>
  );
}
