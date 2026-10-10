"use client";

import { Volume2, VolumeX } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";

import type { EligibleAd } from "@/lib/ads-platform/eligibility";
import { FIT_RULE } from "@/lib/ads-platform/media-spec";
import { markCreativeFailed } from "@/lib/ads-platform/serving-state";
import { claimPlayback, releasePlayback } from "@/lib/media/video-coordinator";
import { cn } from "@/lib/utils";

import { newAdView, observeImpression, trackAdEvent, type AdView } from "../ad-events-client";
import { adSoundOn, setAdSound, useAdSound } from "./ad-sound";

/**
 * ONE paid creative on screen — the only place a self-serve ad's media is
 * rendered, whatever the placement.
 *
 *   · media straight from the storage CDN (`ad.media`) — never through Vercel
 *     or Railway; only THIS creative is fetched, never the pool
 *   · `loaded` when the media arrives, `impression` only after the IAB rule
 *     (`observeImpression`: ≥50 % visible for one continuous second)
 *   · a video plays only while it is at least half on screen, claims the shared
 *     video coordinator so no other clip decodes beside it, and gives its
 *     source back when it unmounts
 *   · a failed image/video is marked failed for the session and the renderer
 *     is told to move on — it is never retried and never shown broken
 *
 * Each mount is a NEW view (a rotation to the next ad is a new view).
 */
export function SelfAdCreative({
  ad,
  placement,
  page,
  fit = FIT_RULE,
  loop = true,
  eager = false,
  backdrop: withBackdrop = true,
  className,
  mediaClassName,
  onFail,
  onEnded,
  onPlaying,
  onView,
}: {
  ad: EligibleAd;
  placement: string;
  page: string;
  fit?: "cover" | "contain";
  loop?: boolean;
  /** the visible top banner is above the fold; everything else is lazy */
  eager?: boolean;
  /** false when the box already has the creative's own shape (the card) — nothing to fill, nothing to fetch */
  backdrop?: boolean;
  className?: string;
  mediaClassName?: string;
  onFail?: () => void;
  onEnded?: () => void;
  /** the video actually started playing (a rotating banner starts its clock here) */
  onPlaying?: () => void;
  /** the view, for a caller that tracks more (click, interstitial_view, reward events) */
  onView?: (view: AdView) => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const view = useMemo(() => newAdView({ campaignId: ad.c, creativeId: ad.cr, placement, page }), [ad.c, ad.cr, placement, page]);

  useEffect(() => {
    onView?.(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    const el = host.current;
    return el ? observeImpression(el, view) : undefined;
  }, [view]);

  /*
    Sound (owner, 2026-10-10: "let video ads play their audio, but users should
    be able to mute"). Tried WITH sound; a browser that refuses sound without a
    tap gets it muted instead and the button says "Tap for sound". The choice is
    the session's (./ad-sound.ts) — muting one ad mutes them all.
  */
  const soundOn = useAdSound();
  const [soundBlocked, setSoundBlocked] = useState(false);
  useEffect(() => {
    const v = video.current;
    if (v) v.muted = !soundOn || soundBlocked;
  }, [soundOn, soundBlocked]);
  const toggleSound = (e: MouseEvent<HTMLButtonElement>) => {
    // the ad itself is a link — the speaker must never open it
    e.preventDefault();
    e.stopPropagation();
    const v = video.current;
    const next = soundBlocked || !soundOn;
    setAdSound(next);
    setSoundBlocked(false);
    if (v) {
      v.muted = !next;
      // inside the tap, so the browser now allows sound
      if (next && v.paused) void v.play().catch(() => {});
    }
  };

  // A video plays only while it is at least half visible — never in the background.
  useEffect(() => {
    const v = video.current;
    if (!v || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e && e.isIntersecting && e.intersectionRatio >= 0.5 && document.visibilityState === "visible") {
          claimPlayback(v);
          v.muted = !adSoundOn();
          void v.play().catch(() => {
            if (v.muted) return; // autoplay refused outright: the first frame stays, nothing is broken
            // sound refused without a tap: play muted and offer "Tap for sound"
            v.muted = true;
            setSoundBlocked(true);
            void v.play().catch(() => {});
          });
        } else v.pause();
      },
      { threshold: [0, 0.5] },
    );
    io.observe(v);
    const onHidden = () => {
      if (document.visibilityState === "hidden") v.pause();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onHidden);
      v.pause();
      releasePlayback(v);
      // give the decoder and the buffered bytes back
      v.removeAttribute("src");
      v.load();
    };
  }, [view]);

  const fail = () => {
    // Part 8: a load failure is reported (batched), so an admin sees a broken creative
    trackAdEvent(view, "load_failed");
    markCreativeFailed(ad.cr);
    onFail?.();
  };

  const alt = ad.headline ? `${ad.headline} — ad from ${ad.sponsor}` : `Ad from ${ad.sponsor}`;
  const media = cn("relative h-full w-full", fit === "cover" ? "object-cover" : "object-contain", mediaClassName);
  /*
    🔴 0208 (owner, 2026-10-09): every creative is shown WHOLE — never stretched,
    squeezed or cropped to fill its slot. Where the creative and the slot differ
    in shape, the space around it is a soft, blurred copy of the creative itself
    (its poster, for a video — never a second video decode), so the box reads as
    one picture instead of hard black bars.
  */
  const backdrop = fit === "contain" && withBackdrop ? (ad.mediaType === "video" ? ad.thumb : ad.media) : null;

  return (
    <div ref={host} className={cn("relative overflow-hidden", fit === "contain" && withBackdrop && (ad.mediaType === "video" ? "bg-black" : "bg-muted"), className)}>
      {backdrop ? (
        // eslint-disable-next-line @next/next/no-img-element -- the same CDN file, already fetched for the creative
        <img src={backdrop} alt="" aria-hidden loading={eager ? "eager" : "lazy"} decoding="async" className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-xl" />
      ) : null}
      {ad.mediaType === "video" ? (
        <video
          ref={video}
          src={ad.thumb ? ad.media : withFirstFrame(ad.media)}
          poster={ad.thumb ?? undefined}
          muted
          playsInline
          loop={loop}
          preload="metadata"
          aria-label={alt}
          className={media}
          onLoadedData={() => trackAdEvent(view, "loaded")}
          onPlaying={() => {
            trackAdEvent(view, "video_start");
            onPlaying?.();
          }}
          onEnded={() => {
            trackAdEvent(view, "video_complete");
            onEnded?.();
          }}
          onError={fail}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- a CDN creative at its own size; next/image would proxy it through Vercel
        <img
          src={ad.media}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          className={media}
          onLoad={() => trackAdEvent(view, "loaded")}
          onError={fail}
        />
      )}
      {ad.mediaType === "video" ? (
        <button
          type="button"
          onClick={toggleSound}
          aria-label={soundOn && !soundBlocked ? "Mute ad" : "Turn ad sound on"}
          aria-pressed={!(soundOn && !soundBlocked)}
          className="absolute bottom-2 right-2 z-20 inline-flex min-h-[2.25rem] items-center gap-1 rounded-full bg-black/55 px-2.5 text-[11px] font-semibold text-white backdrop-blur-sm transition hover:bg-black/70"
        >
          {soundOn && !soundBlocked ? <Volume2 className="h-4 w-4" aria-hidden /> : <VolumeX className="h-4 w-4" aria-hidden />}
          {soundBlocked ? "Tap for sound" : null}
        </button>
      ) : null}
    </div>
  );
}

/**
 * A video ad with no poster shows its own first frame (owner, 2026-10-10, iPhone
 * screenshot: the History-grid ad was a black box). iOS Low Power Mode and data
 * saver refuse autoplay, and a video with no poster that never plays paints
 * black. A `#t=` media fragment makes Safari and Chrome load and show that frame
 * as the still; the fragment is never sent to the server, so caching is unchanged.
 */
export function withFirstFrame(url: string): string {
  return url.includes("#") ? url : `${url}#t=0.1`;
}

/** Record the click on this view, then let the link open the server-validated destination. */
export function trackAdClick(view: AdView | null): void {
  if (view) trackAdEvent(view, "click");
}

/** The destination's host, for a CTA label ("Visit example.com"). */
export function destinationHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
