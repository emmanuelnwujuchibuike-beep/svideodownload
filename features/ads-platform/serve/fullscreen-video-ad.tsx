"use client";

import { ChevronRight, Play, Share2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { toast } from "@/features/ui/toast";
import type { EligibleAd } from "@/lib/ads-platform/eligibility";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

import type { AdView } from "../ad-events-client";
import { openAdDetail } from "./ad-detail-store";
import { destinationHost, SelfAdCreative } from "./self-ad-creative";

/** When the call-to-action bar fills with colour, as TikTok's does a moment into the ad. */
const CTA_HIGHLIGHT_MS = 2500;

/**
 * A VIDEO ad, full screen, in the language people already know from TikTok and Snapchat
 * (owner, 2026-10-14: "make the ad like tiktok and snapchat ads"; earlier the same day: full
 * screen everywhere but the download-result and feed cards, inside the safe areas, full width,
 * text overlaid on the video).
 *
 *   · Snapchat's top: a thin progress line, the brand's badge, name and "Ad" tag, and the
 *     skip countdown / close at the right
 *   · TikTok's right rail: the brand's badge (opens the ad's details, like a profile), Share,
 *     and the sound button — real actions only, no like or comment counts (an ad has none,
 *     and the truth rule forbids made-up numbers)
 *   · TikTok's caption block, bottom left: the brand in bold, the headline and description
 *     (a long one opens with "more"), the "Sponsored" tag, then the call-to-action bar that
 *     starts see-through and fills with colour after a moment
 *   · tap the video to pause it, tap again to play — a play glyph shows while paused
 *
 * The video itself stays where the owner put it: the full width between the safe areas,
 * never cropped (a 9:16 clip is full width; another shape sits whole over a blur of its poster).
 *
 * Presentation only. The caller owns what happens around it — the interstitial's skip
 * countdown and focus trap, the Story card's side taps, the Reels deck's swipe — through
 * `topRight`, `footer` and `children` (drawn over the media, under the rail and the text).
 * Image ads keep their own layouts.
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
  /** false where the surface already has its own top chrome (the Reels deck's tabs): "Ad" moves to the caption */
  header?: boolean;
  ad: EligibleAd;
  placement: string;
  page: string;
  loop?: boolean;
  /** the skip countdown / close button */
  topRight?: ReactNode;
  /** one line above the caption (the reward video's "Your video is saving…") */
  note?: ReactNode;
  /** under the call to action (Continue, a swipe hint) */
  footer?: ReactNode;
  /** over the media, under the rail and the text (tap zones) */
  children?: ReactNode;
  onView?: (view: AdView) => void;
  onEnded?: () => void;
  onFail?: () => void;
  className?: string;
}) {
  const [view, setView] = useState<AdView | null>(null);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [ctaLit, setCtaLit] = useState(false);
  const video = useRef<HTMLVideoElement | null>(null);
  const host = destinationHost(ad.url);
  const initial = ad.sponsor.trim().charAt(0).toUpperCase() || "A";

  useEffect(() => {
    const t = window.setTimeout(() => setCtaLit(true), CTA_HIGHLIGHT_MS);
    return () => window.clearTimeout(t);
  }, [ad.cr]);

  const open = () => openAdDetail(ad, view);

  const togglePause = () => {
    const v = video.current;
    if (!v) return;
    haptic("light");
    if (v.paused) {
      void v.play().catch(() => {});
      setPaused(false);
    } else {
      v.pause();
      setPaused(true);
    }
  };

  const share = async () => {
    haptic("selection");
    const data = { title: ad.headline ?? ad.sponsor, url: ad.url };
    try {
      if (navigator.share) {
        await navigator.share(data);
        return;
      }
      await navigator.clipboard.writeText(ad.url);
      toast("Link copied.", "success");
    } catch {
      /* the share sheet was dismissed */
    }
  };

  const brandBadge = (size: "sm" | "lg") => (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 font-bold text-white ring-2 ring-white",
        size === "lg" ? "h-12 w-12 text-[18px] shadow-[0_6px_18px_-6px_rgba(0,0,0,0.7)]" : "h-9 w-9 text-[15px]",
      )}
      aria-hidden
    >
      {initial}
    </span>
  );

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
          soundAt="rail"
          className="h-full w-full"
          onVideo={(el) => {
            video.current = el;
          }}
          onView={(v) => {
            setView(v);
            onView?.(v);
          }}
          onProgress={setProgress}
          onEnded={onEnded}
          onFail={onFail}
        />
        {/* tap to pause / play, as on TikTok — under the caller's tap zones, the rail and the text */}
        <button type="button" aria-label={paused ? "Play the ad" : "Pause the ad"} onClick={togglePause} className="absolute inset-0 z-[5] cursor-default" />
        {paused ? (
          <span className="pointer-events-none absolute left-1/2 top-1/2 z-[6] flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 backdrop-blur-sm animate-in zoom-in-75 fade-in duration-150 motion-reduce:animate-none" aria-hidden>
            <Play className="ml-1 h-8 w-8 fill-white text-white" />
          </span>
        ) : null}
        <div className="absolute inset-0 z-[7] [&>*]:pointer-events-auto pointer-events-none">{children}</div>

        {/* TikTok's right rail: the brand (opens its details), Share — the sound button sits under them */}
        <div className="absolute right-3 top-1/2 z-20 flex -translate-y-[calc(50%+2.5rem)] flex-col items-center gap-4">
          <button type="button" onClick={open} aria-label={`About ${ad.sponsor}`} className="transition active:scale-90 motion-reduce:active:scale-100">
            {brandBadge("lg")}
          </button>
          <button type="button" onClick={() => void share()} aria-label="Share this ad" className="flex flex-col items-center gap-1 transition active:scale-90 motion-reduce:active:scale-100">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/35 ring-1 ring-inset ring-white/15 backdrop-blur-md">
              <Share2 className="h-5 w-5" aria-hidden />
            </span>
            <span className="text-[11px] font-semibold [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]">Share</span>
          </button>
        </div>
      </div>

      {/* Snapchat's top: progress, brand, Ad, skip — on a soft shade so it reads over any frame */}
      {header ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 bg-gradient-to-b from-black/60 via-black/25 to-transparent pb-10 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
          <div className="mx-2 h-[2.5px] overflow-hidden rounded-full bg-white/30" aria-hidden>
            <div className="h-full origin-left rounded-full bg-white transition-transform duration-200 ease-linear motion-reduce:transition-none" style={{ transform: `scaleX(${progress})` }} />
          </div>
          <div className="mt-2.5 flex items-center gap-2.5 px-3">
            {brandBadge("sm")}
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[14px] font-bold [text-shadow:0_1px_3px_rgba(0,0,0,0.5)]">{ad.sponsor}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[11.5px] font-medium text-white/80 [text-shadow:0_1px_2px_rgba(0,0,0,0.5)]">
                <span className="rounded-[4px] bg-white px-1 py-px text-[9.5px] font-extrabold uppercase tracking-[0.06em] text-black">Ad</span>
                {host || "Sponsored"}
              </p>
            </div>
            {topRight ? <div className="pointer-events-auto shrink-0">{topRight}</div> : null}
          </div>
        </div>
      ) : null}

      {/* TikTok's caption block, bottom left, overlaid — the video runs under it */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3.5 pb-[calc(env(safe-area-inset-bottom)+0.875rem)] pt-24">
        <div className="pointer-events-auto pr-16">
          {note ? <p className="mb-2 text-[12.5px] leading-snug text-white/85">{note}</p> : null}
          <button type="button" onClick={open} className="flex items-center gap-1.5 text-left text-[16px] font-bold [text-shadow:0_1px_3px_rgba(0,0,0,0.5)]">
            {ad.sponsor}
          </button>
          {ad.headline || ad.body ? (
            <button
              type="button"
              onClick={() => setExpanded((x) => !x)}
              aria-expanded={expanded}
              className="mt-1 block w-full text-left text-[14px] leading-snug text-white/95 [text-shadow:0_1px_2px_rgba(0,0,0,0.55)]"
            >
              <span className={expanded ? undefined : "line-clamp-2"}>
                {ad.headline ? <span className="font-semibold">{ad.headline}</span> : null}
                {ad.headline && ad.body ? " " : null}
                {ad.body}
              </span>
              {!expanded && (ad.body?.length ?? 0) + (ad.headline?.length ?? 0) > 70 ? <span className="font-semibold text-white/70">more</span> : null}
            </button>
          ) : null}
          <span className="mt-2 inline-flex items-center gap-1 rounded-[4px] bg-white/20 px-1.5 py-0.5 text-[11px] font-semibold text-white/90 backdrop-blur-sm">
            {header ? null : <span className="font-extrabold uppercase tracking-[0.06em]">Ad ·</span>}
            Sponsored
          </span>
        </div>

        {/* the call-to-action bar: see-through first, then it fills with colour (TikTok) */}
        <a
          href={ad.url}
          target="_blank"
          rel="sponsored noopener noreferrer"
          onClick={(e) => {
            e.preventDefault();
            haptic("selection");
            open();
          }}
          className={cn(
            "pointer-events-auto relative mt-3 flex min-h-[2.875rem] w-full items-center justify-between overflow-hidden rounded-lg px-4 text-[15px] font-semibold transition-[background-color,box-shadow] duration-500 active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100",
            ctaLit ? "bg-gradient-to-r from-indigo-500 to-violet-600 shadow-[0_10px_28px_-12px_rgba(99,102,241,0.95)]" : "bg-white/20 backdrop-blur-md",
          )}
        >
          <span className="truncate">{host ? `Visit ${host}` : "Learn more"}</span>
          <ChevronRight className="h-5 w-5 shrink-0" aria-hidden />
        </a>
        {footer ? <div className="pointer-events-auto">{footer}</div> : null}
      </div>
    </div>
  );
}
