"use client";

import { Expand, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { streamIframeUrl } from "@/lib/media/stream";
import { claimPlayback, recentlyScrolled, recordView, releasePlayback } from "@/lib/media/video-coordinator";
import { cn } from "@/lib/utils";

// A tap only counts if the pointer barely moved AND the page isn't mid-scroll.
const TAP_MOVE_TOLERANCE = 18;

/**
 * Inline feed video. Autoplays muted when scrolled into view (Reels feel) and
 * pauses when out of view.
 *
 * Interaction is device-aware:
 *   • Laptop / desktop (hover + fine pointer): a click toggles play/pause — it
 *     NEVER opens the reel by itself. Hovering reveals the play/pause control and
 *     an "Open reel" (expand) button; a deliberate click on that button, or a
 *     double-click, opens the fullscreen reel.
 *   • Touch: a stationary tap opens the reel; press-and-hold pauses while held.
 * A mute toggle is always reachable. Cloudflare Stream items fall back to the
 * Stream player.
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
  const userPaused = useRef(false);
  const [muted, setMuted] = useState(true);
  const [held, setHeld] = useState(false);
  const [covered, setCovered] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [hoverable, setHoverable] = useState(false);
  const [bigScreen, setBigScreen] = useState(false);
  const iframeMode = !src && !!streamUid;

  // Detect a real hover-capable pointer (mouse) AND a large screen. On any large
  // screen a plain click must never open the reel — even touchscreen laptops —
  // it only plays/pauses; opening is an explicit action (button / double-click).
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const hoverMq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const sizeMq = window.matchMedia("(min-width: 1024px)");
    const update = () => {
      setHoverable(hoverMq.matches);
      setBigScreen(sizeMq.matches);
    };
    update();
    hoverMq.addEventListener?.("change", update);
    sizeMq.addEventListener?.("change", update);
    return () => {
      hoverMq.removeEventListener?.("change", update);
      sizeMq.removeEventListener?.("change", update);
    };
  }, []);
  // "Desktop mode" = never tap-to-open; click toggles playback instead.
  const desktop = hoverable || bigScreen;

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
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  const togglePlay = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused) {
      userPaused.current = false;
      v.play().catch(() => {});
    } else {
      userPaused.current = true;
      v.pause();
    }
  }, []);

  const expand = useCallback(
    (e?: React.SyntheticEvent) => {
      e?.stopPropagation();
      onExpand?.();
    },
    [onExpand],
  );

  // ── Touch gesture model (only wired on non-hover devices) ────────────────
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
        <button type="button" onClick={() => onExpand?.()} aria-label="Watch" className="absolute inset-0" />
      </div>
    );
  }

  if (!src) return null;

  // Touch handlers only bind on small touch screens — on any large screen a
  // click must never open the reel, it toggles playback instead.
  const touchHandlers = desktop
    ? {}
    : { onPointerDown, onPointerMove, onPointerUp: endHold, onPointerLeave: endHold, onPointerCancel: endHold };

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
      onClick={desktop ? togglePlay : undefined}
      onDoubleClick={desktop ? expand : undefined}
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
        className="h-full w-full object-cover lg:h-auto lg:max-h-[82vh] lg:w-auto lg:object-contain"
        onPlay={() => {
          video.current && claimPlayback(video.current);
          setPlaying(true);
        }}
        onPause={() => setPlaying(false)}
        onPlaying={() => {
          setCovered(false);
          if (postId) recordView(postId);
        }}
        {...touchHandlers}
      />

      {/* Cover — shows the poster until the first frame actually plays, so a
          not-yet-decoded clip never flashes a blank black screen. */}
      {covered && poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full object-cover lg:object-contain" />
      ) : null}

      {/* Touch: paused-while-holding indicator */}
      {held ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md">
            <Pause className="h-6 w-6 fill-white" />
          </span>
        </span>
      ) : null}

      {/* Desktop: a play/pause control — revealed on hover (mouse), or shown
          persistently on a large touch screen (no hover to reveal it). */}
      {desktop ? (
        <span
          className={cn(
            "pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-150",
            hoverable ? (playing ? "opacity-0 group-hover:opacity-100" : "opacity-100") : playing ? "opacity-70" : "opacity-100",
          )}
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/45 text-white shadow-lg backdrop-blur-md ring-1 ring-white/20">
            {playing ? <Pause className="h-7 w-7 fill-white" /> : <Play className="h-7 w-7 translate-x-0.5 fill-white" />}
          </span>
        </span>
      ) : null}

      {/* Desktop: explicit "Open reel" button — the ONLY way a click opens the
          reel (a plain click on the video just plays/pauses). */}
      {desktop ? (
        <button
          type="button"
          onClick={expand}
          aria-label="Open reel"
          className={cn(
            "absolute left-2.5 top-2.5 z-10 flex items-center gap-1.5 rounded-full bg-black/45 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-md transition hover:bg-black/65",
            hoverable ? "opacity-0 group-hover:opacity-100" : "opacity-100",
          )}
        >
          <Expand className="h-3.5 w-3.5" /> Open reel
        </button>
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
        {desktop ? "Click to play · Open reel to watch" : "Tap to watch · hold to pause"}
      </span>
    </div>
  );
}
