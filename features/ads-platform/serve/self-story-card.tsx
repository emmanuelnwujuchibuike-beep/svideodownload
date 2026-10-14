"use client";

import { X } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import type { EligibleAd } from "@/lib/ads-platform/eligibility";

import { trackAdEvent, type AdView } from "../ad-events-client";
import { openAdDetail } from "./ad-detail-store";
import { destinationHost, SelfAdCreative } from "./self-ad-creative";

// loaded only when a VIDEO ad opens — an image ad, and every page that never shows one, never fetch it
const FullscreenVideoAd = dynamic(() => import("./fullscreen-video-ad").then((m) => m.FullscreenVideoAd), { ssr: false });

/** How long an IMAGE card stays before the stories continue on their own. */
const IMAGE_MS = 5_000;

/**
 * A paid card between two people's Stories (placement `stories_card`).
 *
 * Inside the existing Story viewer — not a second story product. It follows
 * the viewer's own grammar: a progress line, a side tap moves on, the
 * centre opens the advertiser, X continues. An image advances after 5 s, a video
 * when it ends; a creative that fails continues at once. The story behind it
 * is paused by the viewer while this is up.
 */
export function SelfStoryCard({ ad, onDone }: { ad: EligibleAd; onDone: () => void }) {
  const view = useRef<AdView | null>(null);
  const link = useRef<HTMLAnchorElement | null>(null);
  const [started] = useState(() => Date.now());
  const [pct, setPct] = useState(0);
  const isVideo = ad.mediaType === "video";

  // one rAF loop for the image's progress line — stops on unmount
  useEffect(() => {
    if (isVideo) return;
    let raf = 0;
    let shown = -1;
    const tick = () => {
      const p = Math.min(1, (Date.now() - started) / IMAGE_MS);
      // Part 9: re-render only per 2 % step (~10 Hz), not every frame
      const step = p >= 1 ? 1 : Math.floor(p * 50) / 50;
      if (step !== shown) {
        shown = step;
        setPct(step);
      }
      if (p >= 1) onDone();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isVideo, started, onDone]);

  const host = destinationHost(ad.url);

  // 2026-10-14 (owner): a VIDEO card is the shared full-screen layout — text over the video's foot,
  // the video between the safe areas. The sides still move on; the X continues.
  if (isVideo) {
    return (
      <div className="absolute inset-0 z-30" role="group" aria-label={`Sponsored story from ${ad.sponsor}`}>
        <FullscreenVideoAd
          ad={ad}
          placement="stories_card"
          page="stories"
          loop={false}
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
          {/* the two sides continue (the middle is left to the video); the button at the foot opens the advertiser */}
          <button type="button" aria-label="Next story" onClick={onDone} className="absolute inset-y-0 left-0 w-[30%]" />
          <button type="button" aria-label="Next story" onClick={onDone} className="absolute inset-y-0 right-0 w-[30%]" />
        </FullscreenVideoAd>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-black pb-[env(safe-area-inset-bottom)] pt-[var(--frenz-safe-top,0px)]" role="group" aria-label={`Sponsored story from ${ad.sponsor}`}>
      <div className="mx-3 mt-2 h-0.5 overflow-hidden rounded-full bg-white/25">
        <div className="h-full origin-left bg-white" style={{ transform: `scaleX(${isVideo ? 1 : pct})` }} />
      </div>
      <div className="flex items-center gap-2 px-3 pt-3 text-white">
        <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]">Ad</span>
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{ad.sponsor}</p>
        <button type="button" onClick={onDone} aria-label="Continue to the next story" className="rounded-full bg-white/10 p-2 backdrop-blur">
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <SelfAdCreative
          ad={ad}
          placement="stories_card"
          page="stories"
          fit="contain"
          loop={false}
          eager
          className="h-full w-full"
          onView={(v) => {
            view.current = v;
            trackAdEvent(v, "interstitial_view");
          }}
          onEnded={onDone}
          onFail={onDone}
        />
        {/* sides continue, the (smaller) centre opens the advertiser — an accidental tap never navigates away */}
        <button type="button" aria-label="Next story" onClick={onDone} className="absolute inset-y-0 left-0 w-[35%]" />
        <button type="button" aria-label={`Open ${host || "the advertiser"}`} onClick={() => link.current?.click()} className="absolute inset-y-0 left-[35%] w-[30%]" />
        <button type="button" aria-label="Next story" onClick={onDone} className="absolute inset-y-0 right-0 w-[35%]" />
      </div>

      <div className="px-4 pb-4 pt-3">
        {ad.headline ? <p className="mb-2 text-[14px] font-semibold text-white">{ad.headline}</p> : null}
        <a
          ref={link}
          href={ad.url}
          target="_blank"
          rel="sponsored noopener noreferrer"
          onClick={(e) => {
            e.preventDefault();
            openAdDetail(ad, view.current);
          }}
          className="flex min-h-[2.75rem] items-center justify-center rounded-full bg-white text-[14px] font-semibold text-black"
        >
          {host ? `Visit ${host}` : "Learn more"}
        </a>
      </div>
    </div>
  );
}
