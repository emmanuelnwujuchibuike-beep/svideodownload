"use client";

import { ChevronRight, Play } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import type { EligibleAd } from "@/lib/ads-platform/eligibility";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

import type { AdView } from "../ad-events-client";
import { visitAd } from "./ad-detail-store";
import { destinationHost, SelfAdCreative } from "./self-ad-creative";

/** How long an IMAGE ad's progress line takes to fill, as a Snapchat image Snap does. */
const IMAGE_MS = 5_000;

/** When the call-to-action bar fills with colour, as TikTok's does a moment into the ad. */
const CTA_HIGHLIGHT_MS = 2500;

/**
 * A full-screen ad — VIDEO or IMAGE (2026-10-14, owner: "image too should be full screen except
 * the one on a card") — in the language people already know from TikTok and Snapchat
 * (owner, 2026-10-14: "make the ad like tiktok and snapchat ads"; earlier the same day: full
 * screen everywhere but the download-result and feed cards, inside the safe areas, full width,
 * text overlaid on the video).
 *
 *   · Snapchat's top: a thin progress line, the brand's badge, name and "Ad" tag, and the
 *     skip countdown / close at the right
 *   · the sound button on the right, standing on the call-to-action block. The engagement
 *     tray (brand badge, Like, views, Share) was removed by the owner on 2026-10-18.
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
 * An IMAGE takes the same layout: shown whole across the width over a blur of itself, its
 * progress line filling over `imageMs` like a Snapchat image Snap; it has no sound or pause.
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
  imageMs = IMAGE_MS,
  imageEnds = false,
  className,
  ownsSurface = false,
  navClearance = false,
}: {
  /** the ad IS the full-screen surface (the Reels deck): it autoplays despite the deck's playback suspension (SelfAdCreative) */
  ownsSurface?: boolean;
  /**
   * The app's floating bottom nav is drawn over this layout (the Reels deck): the caption, the call to
   * action and the rail stand above it (owner 2026-10-17: "the bottom NAV is blocking the bottom visit
   * button"). The nav publishes its real height (--frenz-bottomnav-h, safe area included, 0 when not
   * shown); only what it needs beyond the safe area is added.
   */
  navClearance?: boolean;
  /** an IMAGE ad's on-screen time: its progress line fills over this */
  imageMs?: number;
  /** an image calls onEnded when its time is up (the Stories card moves on); an interstitial's never does */
  imageEnds?: boolean;
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
  // the CTA block's height (the bar plus any caller footer) as --ad-cta: the rail and the sound
  // button stand on it, whatever the caller puts under the bar
  const rootRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    const cta = ctaRef.current;
    if (!root || !cta) return;
    const set = () => root.style.setProperty("--ad-cta", `${Math.round(cta.getBoundingClientRect().height)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(cta);
    return () => ro.disconnect();
  }, []);
  const [ctaLit, setCtaLit] = useState(false);
  const video = useRef<HTMLVideoElement | null>(null);
  const captionRef = useRef<HTMLSpanElement | null>(null);
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    const el = captionRef.current;
    if (!el) return;
    const measure = () => setClipped(el.scrollHeight - el.clientHeight > 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ad.cr]);
  const host = destinationHost(ad.url);
  const initial = ad.sponsor.trim().charAt(0).toUpperCase() || "A";

  /*
    No engagement tray (owner, 2026-10-18: "remove the engagement tray from the video ad"). The
    TikTok-style right rail — brand badge, Like, views, Share — is gone, and with it the per-ad
    engagement fetch. The sponsor name and the call-to-action bar still open the advertiser.
  */

  useEffect(() => {
    const t = window.setTimeout(() => setCtaLit(true), CTA_HIGHLIGHT_MS);
    return () => window.clearTimeout(t);
  }, [ad.cr]);

  // an IMAGE has no clock of its own: the progress line runs over `imageMs` (one CSS transition, no loop)
  const isVideo = ad.mediaType === "video";
  const endedRef = useRef(onEnded);
  endedRef.current = onEnded;
  useEffect(() => {
    if (isVideo) return;
    const start = window.requestAnimationFrame(() => setProgress(1));
    const done = imageEnds ? window.setTimeout(() => endedRef.current?.(), imageMs) : 0;
    return () => {
      window.cancelAnimationFrame(start);
      window.clearTimeout(done);
    };
  }, [isVideo, imageMs, imageEnds, ad.cr]);

  // every way into the advertiser opens the link at once, as Snapchat does (owner, 2026-10-15) — no sheet, no warning
  const open = () => {
    haptic("selection");
    visitAd(ad, view);
  };

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
    <div
      ref={rootRef}
      className={cn("relative h-full w-full overflow-hidden bg-black text-white", className)}
      style={navClearance ? ({ "--ad-nav": "max(0px, calc(var(--frenz-bottomnav-h, 0px) - env(safe-area-inset-bottom)))" } as CSSProperties) : undefined}
    >
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
          ownsSurface={ownsSurface}
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
        {isVideo ? <button type="button" aria-label={paused ? "Play the ad" : "Pause the ad"} onClick={togglePause} className="absolute inset-0 z-[5] cursor-default" /> : null}
        {paused ? (
          <span className="pointer-events-none absolute left-1/2 top-1/2 z-[6] flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 backdrop-blur-sm animate-in zoom-in-75 fade-in duration-150 motion-reduce:animate-none" aria-hidden>
            <Play className="ml-1 h-8 w-8 fill-white text-white" />
          </span>
        ) : null}
        <div className="absolute inset-0 z-[7] [&>*]:pointer-events-auto pointer-events-none">{children}</div>

      </div>

      {/* Snapchat's top: progress, brand, Ad, skip — on a soft shade so it reads over any frame */}
      {header ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 bg-gradient-to-b from-black/60 via-black/25 to-transparent pb-10 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
          <div className="mx-2 h-[2.5px] overflow-hidden rounded-full bg-white/30" aria-hidden>
            <div className="h-full origin-left rounded-full bg-white transition-transform duration-200 ease-linear motion-reduce:transition-none" style={{ transform: `scaleX(${progress})`, ...(isVideo ? {} : { transitionDuration: `${imageMs}ms` }) }} />
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
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3.5 pb-[calc(env(safe-area-inset-bottom)+var(--ad-nav,0px)+0.875rem)] pt-24">
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
              <span ref={captionRef} className={expanded ? undefined : "line-clamp-2"}>
                {ad.headline ? <span className="font-semibold">{ad.headline}</span> : null}
                {ad.headline && ad.body ? " " : null}
                {ad.body}
              </span>
              {/* "more" only when the two lines really cut the text off — measured, not guessed */}
              {!expanded && clipped ? <span className="font-semibold text-white/70">more</span> : null}
            </button>
          ) : null}
          <span className="mt-2 inline-flex items-center gap-1 rounded-[4px] bg-white/20 px-1.5 py-0.5 text-[11px] font-semibold text-white/90 backdrop-blur-sm">
            {header ? null : <span className="font-extrabold uppercase tracking-[0.06em]">Ad ·</span>}
            Sponsored
          </span>
        </div>

        {/* the call-to-action bar: see-through first, then it fills with colour (TikTok) — measured with the footer, for the rail */}
        <div ref={ctaRef}>
        <a
          href={ad.url}
          target="_blank"
          rel="sponsored noopener noreferrer"
          onClick={(e) => {
            e.preventDefault();
            open();
          }}
          className={cn(
            "pointer-events-auto relative mt-3 flex min-h-[3.25rem] w-full touch-manipulation select-none items-center justify-between overflow-hidden rounded-lg px-4 text-[15px] font-semibold transition-[background-color,box-shadow] duration-500 active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100",
            ctaLit ? "bg-gradient-to-r from-indigo-500 to-violet-600 shadow-[0_10px_28px_-12px_rgba(99,102,241,0.95)]" : "bg-white/20 backdrop-blur-md",
          )}
        >
          <span className="truncate">{host ? `Visit ${host}` : "Learn more"}</span>
          <ChevronRight className="h-5 w-5 shrink-0" aria-hidden />
        </a>
        {footer ? <div className="pointer-events-auto">{footer}</div> : null}
        </div>
      </div>
    </div>
  );
}

/** The same layout under its general name — it shows images as well as videos. */
export const FullscreenAd = FullscreenVideoAd;
