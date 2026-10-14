"use client";

import { X } from "lucide-react";
import dynamic from "next/dynamic";
import { useRef } from "react";

import type { EligibleAd } from "@/lib/ads-platform/eligibility";

import { trackAdEvent, type AdView } from "../ad-events-client";

// loaded only when a paid card opens — every Stories session without one never fetches it
const FullscreenAd = dynamic(() => import("./fullscreen-video-ad").then((m) => m.FullscreenAd), { ssr: false });

/** How long an IMAGE card stays before the stories continue on their own. */
const IMAGE_MS = 5_000;

/**
 * A paid card between two people's Stories (placement `stories_card`).
 *
 * Inside the existing Story viewer — not a second story product. It follows the viewer's own
 * grammar in the shared full-screen layout (owner, 2026-10-14: full screen like Snapchat and
 * TikTok, image or video): a progress line, a side tap moves on, X continues, the call to action
 * and the brand open the advertiser. An image advances after 5 s, a video when it ends; a
 * creative that fails continues at once. The story behind it is paused by the viewer while this
 * is up.
 */
export function SelfStoryCard({ ad, onDone }: { ad: EligibleAd; onDone: () => void }) {
  const view = useRef<AdView | null>(null);

  return (
    <div className="absolute inset-0 z-30" role="group" aria-label={`Sponsored story from ${ad.sponsor}`}>
      <FullscreenAd
        ad={ad}
        placement="stories_card"
        page="stories"
        loop={false}
        imageMs={IMAGE_MS}
        imageEnds
        topRight={
          <button type="button" onClick={onDone} aria-label="Continue to the next story" className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white ring-1 ring-inset ring-white/20 backdrop-blur-md">
            <X className="h-[18px] w-[18px]" aria-hidden />
          </button>
        }
        onView={(v) => {
          view.current = v;
          trackAdEvent(v, "interstitial_view");
        }}
        onEnded={onDone}
        onFail={onDone}
      >
        {/* the two sides continue (the middle is left to the ad); the button at the foot opens the advertiser */}
        <button type="button" aria-label="Next story" onClick={onDone} className="absolute inset-y-0 left-0 w-[30%]" />
        <button type="button" aria-label="Next story" onClick={onDone} className="absolute inset-y-0 right-0 w-[30%]" />
      </FullscreenAd>
    </div>
  );
}
