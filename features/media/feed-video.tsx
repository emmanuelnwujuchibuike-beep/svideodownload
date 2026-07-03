"use client";

import { Pause, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { streamIframeUrl } from "@/lib/media/stream";
import { claimPlayback, recentlyScrolled, releasePlayback } from "@/lib/media/video-coordinator";
import { cn } from "@/lib/utils";

// A tap only counts if the pointer barely moved AND the page isn't mid-scroll.
const TAP_MOVE_TOLERANCE = 18;

/**
 * Inline feed video. Autoplays muted when scrolled into view (Reels feel) and
 * pauses when out of view. Interaction:
 *   • tap        → open the fullscreen reel (onExpand)
 *   • press-hold → pause while held, resume on release
 * A mute toggle is always reachable. Cloudflare Stream items fall back to the
 * Stream player (tap still expands).
 */
export function FeedVideo({
  src,
  streamUid,
  poster,
  className,
  onExpand,
}: {
  src?: string | null;
  streamUid?: string | null;
  poster?: string | null;
  className?: string;
  onExpand?: () => void;
}) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holding = useRef(false);
  const moved = useRef(false);
  const startPt = useRef<{ x: number; y: number } | null>(null);
  const userPaused = useRef(false);
  const [muted, setMuted] = useState(true);
  const [held, setHeld] = useState(false);
  const [covered, setCovered] = useState(true);
  const iframeMode = !src && !!streamUid;

  // In-view autoplay / pause (native player only). Plays as soon as 40% of the
  // video is on screen — it's usually already playing by the time it's centered.
  useEffect(() => {
    if (iframeMode) return;
    const el = wrap.current;
    const v = video.current;
    if (!el || !v) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.4) {
          if (!userPaused.current) v.play().catch(() => {});
        } else {
          v.pause();
        }
      },
      { threshold: [0, 0.4, 1] },
    );
    obs.observe(el);
    return () => {
      obs.disconnect();
      releasePlayback(v);
    };
  }, [iframeMode]);

  const toggleMute = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const v = video.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  // Press-and-hold to pause; a *stationary* quick tap opens the fullscreen reel.
  // A drag/scroll (pointer moved past a small threshold) never counts as a tap,
  // so scrolling the feed can't accidentally open a reel.
  const onPointerDown = (e: React.PointerEvent) => {
    holding.current = false;
    moved.current = false;
    startPt.current = { x: e.clientX, y: e.clientY };
    holdTimer.current = setTimeout(() => {
      if (moved.current) return;
      holding.current = true;
      setHeld(true);
      video.current?.pause();
    }, 170);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!startPt.current || moved.current) return;
    const dx = Math.abs(e.clientX - startPt.current.x);
    const dy = Math.abs(e.clientY - startPt.current.y);
    if (dx > TAP_MOVE_TOLERANCE || dy > TAP_MOVE_TOLERANCE) {
      moved.current = true;
      // Cancel a pending hold-pause once it's clearly a scroll.
      if (holdTimer.current) clearTimeout(holdTimer.current);
      if (holding.current) {
        holding.current = false;
        setHeld(false);
        video.current?.play().catch(() => {});
      }
    }
  };
  const endHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (holding.current) {
      holding.current = false;
      setHeld(false);
      video.current?.play().catch(() => {});
    } else if (!moved.current && !recentlyScrolled()) {
      // Only a deliberate, stationary tap on a settled feed opens the reel.
      onExpand?.();
    }
    startPt.current = null;
  };

  if (iframeMode) {
    return (
      <div ref={wrap} className={cn("relative overflow-hidden bg-black", className)}>
        <iframe
          src={`${streamIframeUrl(streamUid!)}?autoplay=true&muted=true&loop=true`}
          title="Video"
          loading="lazy"
          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
          allowFullScreen
          className="pointer-events-none h-full w-full border-0"
        />
        <button type="button" onClick={onExpand} aria-label="Watch" className="absolute inset-0" />
      </div>
    );
  }

  if (!src) return null;

  return (
    <div
      ref={wrap}
      className={cn(
        "group relative overflow-hidden bg-black",
        // On laptops/desktops the whole video fits the screen height (never taller
        // than 82vh) so you never scroll to see a full clip; phones stay immersive.
        "lg:flex lg:aspect-auto lg:max-h-[82vh] lg:items-center lg:justify-center",
        className,
      )}
    >
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={video}
        src={src}
        poster={poster ?? undefined}
        loop
        muted
        playsInline
        preload="metadata"
        className="h-full w-full object-cover lg:h-auto lg:max-h-[82vh] lg:w-auto lg:object-contain"
        onPlay={() => video.current && claimPlayback(video.current)}
        onPlaying={() => setCovered(false)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endHold}
        onPointerLeave={endHold}
        onPointerCancel={endHold}
      />

      {/* Cover — shows the poster until the first frame actually plays, so a
          not-yet-decoded clip never flashes a blank black screen. */}
      {covered && poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full object-cover lg:object-contain" />
      ) : null}

      {/* Paused (while holding) indicator */}
      {held ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md">
            <Pause className="h-6 w-6 fill-white" />
          </span>
        </span>
      ) : null}

      {/* Mute toggle */}
      <button
        type="button"
        onClick={toggleMute}
        aria-label={muted ? "Unmute" : "Mute"}
        className="absolute right-2.5 top-2.5 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md transition hover:bg-black/65"
      >
        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>

      {/* Hint */}
      <span className="pointer-events-none absolute bottom-2 left-2.5 z-10 rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur">
        Tap to watch · hold to pause
      </span>
    </div>
  );
}
