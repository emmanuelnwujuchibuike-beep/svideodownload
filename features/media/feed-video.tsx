"use client";

import { Pause, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAdaptiveSource } from "@/features/media/use-adaptive-source";
import { muteInstant, unmuteWithFade } from "@/lib/media/audio-playback";
import { streamHlsUrl, streamIframeUrl } from "@/lib/media/stream";
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
  streamFailed,
  poster,
  className,
  postId,
  onExpand,
}: {
  src?: string | null;
  streamUid?: string | null;
  /** A confirmed Stream encode failure (webhook) — skip HLS, go straight to MP4. */
  streamFailed?: boolean;
  poster?: string | null;
  className?: string;
  /** Post id — lets an actual watch record a (deduped) view. */
  postId?: string;
  onExpand?: () => void;
}) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pauseSignTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holding = useRef(false);
  const moved = useRef(false);
  const startPt = useRef<{ x: number; y: number } | null>(null);
  const downAt = useRef(0);
  const userPaused = useRef(false);
  const [muted, setMuted] = useState(true);
  const [showPause, setShowPause] = useState(false);
  const [covered, setCovered] = useState(true);
  const [shouldLoad, setShouldLoad] = useState(false);
  const inViewRef = useRef(false);
  const readyRef = useRef(false);

  // Adaptive playback: a Cloudflare Stream video plays HLS/ABR through our own
  // <video>; anything else plays the plain MP4. Fall back to the Stream iframe only
  // when there's a uid but neither an HLS URL (no customer code) nor an MP4.
  const hlsUrl = streamUid && !streamFailed ? streamHlsUrl(streamUid) : null;
  const hasNative = !!src || !!hlsUrl;
  const iframeMode = !hasNative && !!streamUid;

  const playIfReady = useCallback(() => {
    const v = video.current;
    if (v && inViewRef.current && readyRef.current && !userPaused.current) v.play().catch(() => {});
  }, []);
  const onSrcReady = useCallback(() => {
    readyRef.current = true;
    playIfReady();
  }, [playIfReady]);
  // Only wire the source when the clip is near the viewport (releases decoders +
  // avoids buffering every feed video at once — battery/data), and re-attach as it
  // scrolls back. `preload="metadata"` on the element keeps the MP4 path light too.
  useAdaptiveSource(video, { hlsUrl, src, poster, active: shouldLoad, onReady: onSrcReady, postId: postId ?? undefined });

  // In-view autoplay / pause. Loads at a 200px margin (just before visible), plays
  // muted once 40% on screen. Plays as soon as the source is ready.
  useEffect(() => {
    if (iframeMode) return;
    const el = wrap.current;
    const v = video.current;
    if (!el || !v) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        setShouldLoad(entry.isIntersecting);
        if (entry.isIntersecting && entry.intersectionRatio >= 0.4) {
          inViewRef.current = true;
          playIfReady();
        } else {
          // Leaving view resets a manual pause so it resumes fresh on return.
          inViewRef.current = false;
          v.pause();
          userPaused.current = false;
          setShowPause(false);
        }
      },
      { threshold: [0, 0.4, 1], rootMargin: "200px 0px" },
    );
    obs.observe(el);
    return () => {
      obs.disconnect();
      releasePlayback(v);
    };
  }, [iframeMode, playIfReady]);

  // Clear pending timers on unmount (no leaks during long scroll sessions).
  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      if (pauseSignTimer.current) clearTimeout(pauseSignTimer.current);
    },
    [],
  );

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

  const resumePlay = () => {
    const v = video.current;
    if (!v) return;
    userPaused.current = false;
    setShowPause(false);
    void v.play().catch(() => {});
  };

  // ── Feed video gesture model ─────────────────────────────────────────────
  //   • single tap  → open the full-screen reels
  //   • press-hold  → pause (while held); release resumes
  // Guarded so a graze, drag, hover, or scroll-tail never triggers either.
  const onPointerDown = (e: React.PointerEvent) => {
    holding.current = false;
    moved.current = false;
    startPt.current = { x: e.clientX, y: e.clientY };
    downAt.current = Date.now();
    holdTimer.current = setTimeout(() => {
      if (moved.current) return;
      holding.current = true; // press-and-hold → pause
      const v = video.current;
      if (v) {
        userPaused.current = true;
        v.pause();
        setShowPause(true);
      }
    }, 300);
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
        resumePlay();
      }
    }
  };
  const endHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    const started = startPt.current !== null;
    const dur = Date.now() - downAt.current;
    startPt.current = null;
    if (holding.current) {
      holding.current = false; // was a press-hold pause → resume
      resumePlay();
      return;
    }
    // Deliberate quick tap → open full-screen reels.
    if (started && !moved.current && dur >= 40 && dur < 300 && !recentlyScrolled(500)) {
      onExpand?.();
    }
  };
  const onPointerLeaveCancel = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (holding.current) {
      holding.current = false;
      resumePlay();
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

  if (!hasNative) return null;

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
        // Source (HLS or MP4, seeked to a first frame when there's no poster) is
        // attached imperatively by useAdaptiveSource when near the viewport.
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
      {showPause ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md">
            <Pause className="h-7 w-7 fill-white" />
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
