"use client";

import { Pause, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { muteInstant, unmuteWithFade } from "@/lib/media/audio-playback";
import { streamIframeUrl } from "@/lib/media/stream";
import { claimPlayback, recentlyScrolled, recordView, releasePlayback } from "@/lib/media/video-coordinator";
import { cn } from "@/lib/utils";

// A tap only counts if the pointer barely moved AND the page isn't mid-scroll.
const TAP_MOVE_TOLERANCE = 18;

/**
 * Inline feed video. Autoplays muted when scrolled into view (Reels feel) and
 * pauses when out of view.
 *
 * Interaction (same on every device): a deliberate tap/click opens the fullscreen
 * reel — heavily guarded so it never fires on a graze, drag, hover, or the tail of
 * a scroll. Press-and-hold pauses while held (and never opens). A mute toggle is
 * always reachable. Cloudflare Stream items fall back to the Stream player.
 */
export function FeedVideo({
  src,
  streamUid,
  poster,
  className,
  postId,
  onExpand,
}: {
  src?: string | null;
  streamUid?: string | null;
  poster?: string | null;
  className?: string;
  /** Post id — lets an actual watch record a (deduped) view. */
  postId?: string;
  onExpand?: () => void;
}) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holding = useRef(false);
  const moved = useRef(false);
  const startPt = useRef<{ x: number; y: number } | null>(null);
  const downAt = useRef(0);
  const userPaused = useRef(false);
  const [muted, setMuted] = useState(true);
  const [held, setHeld] = useState(false);
  const [covered, setCovered] = useState(true);
  const iframeMode = !src && !!streamUid;

  // In-view autoplay / pause (native player only). Plays as soon as 40% of the
  // video is on screen — usually already playing by the time it's centered.
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
    // Unmuting is the ONLY point we take audio focus, and only on this explicit
    // tap — with a gentle fade-in. Muting restores external audio instantly.
    if (v.muted) unmuteWithFade(v);
    else muteInstant(v);
    setMuted(v.muted);
  }, []);

  // ── Unified tap-to-open gesture (all devices) ────────────────────────────
  // A deliberate tap/click anywhere on the video opens the fullscreen reel. It is
  // heavily guarded so it never fires on a slight graze, a drag, a hover, or the
  // tail of a scroll — press-and-hold pauses instead (and never opens).
  const onPointerDown = (e: React.PointerEvent) => {
    holding.current = false;
    moved.current = false;
    startPt.current = { x: e.clientX, y: e.clientY };
    downAt.current = Date.now();
    holdTimer.current = setTimeout(() => {
      if (moved.current) return;
      holding.current = true;
      setHeld(true);
      video.current?.pause();
    }, 220);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!startPt.current || moved.current) return;
    const dx = Math.abs(e.clientX - startPt.current.x);
    const dy = Math.abs(e.clientY - startPt.current.y);
    if (dx > TAP_MOVE_TOLERANCE || dy > TAP_MOVE_TOLERANCE) {
      moved.current = true;
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
    const started = startPt.current !== null;
    const dur = Date.now() - downAt.current;
    if (holding.current) {
      // Was a press-and-hold to pause → resume, never open.
      holding.current = false;
      setHeld(false);
      video.current?.play().catch(() => {});
      startPt.current = null;
      return;
    }
    startPt.current = null;
    // Deliberate tap only: pressed here, barely moved, quick (not a graze/hold),
    // and the feed isn't mid-scroll.
    if (started && !moved.current && dur >= 60 && dur <= 500 && !recentlyScrolled(500)) {
      onExpand?.();
    }
  };
  const onPointerLeaveCancel = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (holding.current) {
      holding.current = false;
      setHeld(false);
      video.current?.play().catch(() => {});
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
        <button type="button" onClick={() => onExpand?.()} aria-label="Watch" className="absolute inset-0" />
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
        // With no poster image, seek to a frame (#t) so the video shows a still
        // instead of black before it autoplays — matches the profile grid.
        src={poster ? src : `${src}#t=0.1`}
        poster={poster ?? undefined}
        loop
        muted
        playsInline
        preload="metadata"
        className="h-full w-full touch-pan-y object-cover lg:h-auto lg:max-h-[82vh] lg:w-auto lg:object-contain"
        onPlay={() => {
          video.current && claimPlayback(video.current);
        }}
        onPlaying={() => {
          setCovered(false);
          if (postId) recordView(postId);
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endHold}
        onPointerLeave={onPointerLeaveCancel}
        onPointerCancel={onPointerLeaveCancel}
      />

      {/* Cover — shows the poster until the first frame actually plays, so a
          not-yet-decoded clip never flashes a blank black screen. */}
      {covered && poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full object-cover lg:object-contain" />
      ) : null}

      {/* Paused-while-holding indicator */}
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
      <span className="pointer-events-none absolute bottom-2 left-2.5 z-10 rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-medium text-white/90 opacity-0 backdrop-blur transition-opacity duration-200 group-hover:opacity-100">
        Tap to watch · hold to pause
      </span>
    </div>
  );
}
