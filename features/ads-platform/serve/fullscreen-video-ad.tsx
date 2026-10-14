"use client";

import { ArrowUpRight } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { EligibleAd } from "@/lib/ads-platform/eligibility";
import { cn } from "@/lib/utils";

import type { AdView } from "../ad-events-client";
import { openAdDetail } from "./ad-detail-store";
import { destinationHost, SelfAdCreative } from "./self-ad-creative";

/**
 * A VIDEO ad, full screen — the History viewer's grammar (owner, 2026-10-14: "make video ad
 * everywhere except the download result card and the feed card show in full screen like the
 * history viewer … a 9:16 video should show full but not cross the safe area, full width;
 * title, description and sponsor at the bottom, overlaid on the video, the video going under
 * it … professional and premium").
 *
 *   · the video fills the width of the space BETWEEN the safe areas (status bar / notch above,
 *     home indicator below) and is never cropped: a 9:16 clip is full width on a phone, a
 *     different shape sits whole over a soft blur of its own poster
 *   · a thin progress line and the "Ad · sponsor" row float over its top edge
 *   · sponsor, headline, description and the call to action float over its foot on a
 *     gradient, so the video runs underneath them instead of stopping above a white card
 *   · the sound control sits under the top row, clear of the text and the button
 *
 * Presentation only. The caller owns what happens around it — the interstitial's skip
 * countdown and focus trap, the Story card's tap zones, the Reels deck's swipe — through
 * `topRight`, `footer` and `children` (drawn over the media, under the overlays).
 * Image ads are untouched: they keep their own layouts.
 */
export function FullscreenVideoAd({
  ad,
  placement,
  page,
  loop = true,
  topRight,
  note,
  footer,
  children,
  onView,
  onEnded,
  onFail,
  header = true,
  className,
}: {
  /** false where the surface already has its own top chrome (the Reels deck's tabs): "Ad" moves to the foot */
  header?: boolean;
  ad: EligibleAd;
  placement: string;
  page: string;
  loop?: boolean;
  /** the skip countdown / close button */
  topRight?: ReactNode;
  /** one line above the headline (the reward video's "Your video is saving…") */
  note?: ReactNode;
  /** under the call to action (Continue, a swipe hint) */
  footer?: ReactNode;
  /** over the media, under the overlays (tap zones) */
  children?: ReactNode;
  onView?: (view: AdView) => void;
  onEnded?: () => void;
  onFail?: () => void;
  className?: string;
}) {
  const [view, setView] = useState<AdView | null>(null);
  const [progress, setProgress] = useState(0);
  const host = destinationHost(ad.url);

  return (
    <div className={cn("relative h-full w-full overflow-hidden bg-black text-white", className)}>
      {/* the media, inside the safe areas — full width, never cropped, never under the notch or the home bar */}
      <div className="absolute inset-x-0 bottom-[env(safe-area-inset-bottom)] top-[env(safe-area-inset-top)]">
        <SelfAdCreative
          ad={ad}
          placement={placement}
          page={page}
          fit="contain"
          loop={loop}
          eager
          soundAt="top"
          className="h-full w-full"
          onView={(v) => {
            setView(v);
            onView?.(v);
          }}
          onProgress={setProgress}
          onEnded={onEnded}
          onFail={onFail}
        />
        {children}
      </div>

      {/* top: progress, Ad, sponsor, skip — on a soft shade so it reads over any frame */}
      {header ? (
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/70 via-black/30 to-transparent pb-10 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
        <div className="mx-3 h-[3px] overflow-hidden rounded-full bg-white/25" aria-hidden>
          <div className="h-full origin-left rounded-full bg-white transition-transform duration-200 ease-linear motion-reduce:transition-none" style={{ transform: `scaleX(${progress})` }} />
        </div>
        <div className="mt-3 flex items-center gap-2.5 px-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-[15px] font-bold shadow-[0_4px_14px_-4px_rgba(99,102,241,0.8)] ring-2 ring-white/80" aria-hidden>
            {ad.sponsor.trim().charAt(0).toUpperCase() || "A"}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[14px] font-semibold [text-shadow:0_1px_3px_rgba(0,0,0,0.5)]">{ad.sponsor}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-white/75">
              <span className="rounded-[4px] bg-white/90 px-1 py-px text-[9.5px] font-bold uppercase tracking-[0.06em] text-black">Ad</span>
              Sponsored
            </p>
          </div>
          {topRight ? <div className="pointer-events-auto shrink-0">{topRight}</div> : null}
        </div>
      </div>
      ) : null}

      {/* foot: sponsor, title, description and the call to action, overlaid — the video runs under it */}
      <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-28">
        {note ? <p className="mb-2 text-[12.5px] leading-snug text-white/80">{note}</p> : null}
        <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-white/70">
          {header ? null : <span className="rounded-[4px] bg-white/90 px-1 py-px text-[9.5px] font-bold tracking-[0.06em] text-black">Ad</span>}
          {ad.sponsor}
        </p>
        {ad.headline ? <p className="mt-1 text-[19px] font-bold leading-snug tracking-tight [text-shadow:0_1px_4px_rgba(0,0,0,0.45)]">{ad.headline}</p> : null}
        {ad.body ? <p className="mt-1 line-clamp-2 text-[14px] leading-snug text-white/85">{ad.body}</p> : null}
        <a
          href={ad.url}
          target="_blank"
          rel="sponsored noopener noreferrer"
          onClick={(e) => {
            e.preventDefault();
            openAdDetail(ad, view);
          }}
          className="mt-4 flex min-h-[3rem] w-full items-center justify-center gap-1.5 rounded-full bg-white text-[15px] font-semibold text-black shadow-[0_10px_30px_-12px_rgba(0,0,0,0.8)] transition active:scale-[0.98] motion-reduce:active:scale-100"
        >
          {host ? `Visit ${host}` : "Learn more"} <ArrowUpRight className="h-4 w-4" aria-hidden />
        </a>
        {footer}
      </div>
    </div>
  );
}
