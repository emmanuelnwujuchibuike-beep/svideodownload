"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Maximize2, Pause, Volume2, VolumeX } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import { WowSolid } from "@/components/brand/wow-icon";
import { useAdaptiveSource } from "@/features/media/use-adaptive-source";
import { neutralizeAncestorTransforms } from "@/lib/dom/neutralize-transforms";
import { muteInstant, unmuteWithFade } from "@/lib/media/audio-playback";
import { getPlaybackPosition, savePlaybackPosition } from "@/lib/media/resume-positions";
import { streamHlsUrl, streamIframeUrl } from "@/lib/media/stream";
import { claimPlayback, recentlyScrolled, recordView, releasePlayback } from "@/lib/media/video-coordinator";
import { cn } from "@/lib/utils";

// Fullscreen chrome loads only on first use — never in the feed bundle.
const FullscreenVideoLayer = dynamic(
  () => import("@/features/media/fullscreen-video").then((m) => m.FullscreenVideoLayer),
  { ssr: false },
);

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
  streamReady,
  streamFailed,
  poster,
  className,
  postId,
  onExpand,
  onDoubleTapLike,
}: {
  src?: string | null;
  streamUid?: string | null;
  /** Stream encode confirmed COMPLETE — before that, prefer the MP4 (plays instantly). */
  streamReady?: boolean;
  /** A confirmed Stream encode failure (webhook) — skip HLS, go straight to MP4. */
  streamFailed?: boolean;
  poster?: string | null;
  className?: string;
  /** Post id — lets an actual watch record a (deduped) view. */
  postId?: string;
  onExpand?: () => void;
  /** Wow handler for the fullscreen double-tap-center gesture. */
  onDoubleTapLike?: () => void;
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
  // Double-tap-to-Wow (Instagram/TikTok style, matching FeedImage): a lone
  // tap opens fullscreen only after a short grace window with no follow-up
  // tap; two taps within that window like the post instead and never open
  // fullscreen — same pattern every other media surface already uses.
  const lastTapAt = useRef(0);
  const expandTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [burst, setBurst] = useState(0);
  const [muted, setMuted] = useState(true);
  const [showPause, setShowPause] = useState(false);
  const [covered, setCovered] = useState(true);
  const [shouldLoad, setShouldLoad] = useState(false);
  // The card shows the video at its TRUE aspect ratio — nothing is ever
  // cropped. Tall clips expand toward full 9:16; short/wide clips render as
  // they are (letterboxed only past the clamps). Measured from the video
  // itself on loadedmetadata; 3:4 reserves space until then.
  const [ratio, setRatio] = useState<number | null>(null);
  const inViewRef = useRef(false);
  const readyRef = useRef(false);

  // ── Fullscreen (owner spec: native-app quality) ────────────────────────────
  // The SAME box (and <video>) is promoted to a fixed, edge-to-edge layer, so
  // entering/exiting is a single style change: instant, no reload, no flicker,
  // playback position preserved by construction. Where the native Fullscreen
  // API exists (Android/desktop) we also engage it for true edge-to-edge;
  // iOS Safari/PWA uses the overlay alone (its API can't host custom chrome).
  const [fs, setFs] = useState(false);
  const fsRef = useRef(false);
  const fsBox = useRef<HTMLDivElement | null>(null);
  const restoreTransforms = useRef<(() => void) | null>(null);

  const enterFs = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    fsRef.current = true;
    setFs(true);
    // Lock body scroll — overflowY specifically (the shorthand breaks sticky
    // layouts elsewhere; see shell notes).
    document.body.style.overflowY = "hidden";
    // Belt-and-suspenders: a card wrapper up the tree (e.g. the feed card's
    // entrance-animation motion.article) can carry a lingering inline
    // transform that would otherwise anchor this "fixed" box to ITS box
    // instead of the true viewport — see lib/dom/neutralize-transforms.
    restoreTransforms.current = neutralizeAncestorTransforms(fsBox.current);
    const box = fsBox.current as (HTMLDivElement & { requestFullscreen?: () => Promise<void> }) | null;
    if (box && typeof box.requestFullscreen === "function") box.requestFullscreen().catch(() => {});
  }, []);
  const exitFs = useCallback(() => {
    fsRef.current = false;
    setFs(false);
    document.body.style.overflowY = "";
    restoreTransforms.current?.();
    restoreTransforms.current = null;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, []);
  // Native fullscreen dismissed by the browser (Esc / system gesture) → fold
  // the overlay too so the two never disagree.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement && fsRef.current) {
        fsRef.current = false;
        setFs(false);
        document.body.style.overflowY = "";
        restoreTransforms.current?.();
        restoreTransforms.current = null;
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      if (fsRef.current) document.body.style.overflowY = "";
      restoreTransforms.current?.();
    };
  }, []);

  // Adaptive playback: a Cloudflare Stream video plays HLS/ABR through our own
  // <video>; anything else plays the plain MP4. A freshly uploaded video whose
  // Stream encode hasn't been CONFIRMED ready plays the MP4 (instant) instead of
  // hanging on a not-yet-existing manifest — the HLS ladder takes over on later
  // views once the webhook flips stream_ready. Fall back to the Stream iframe
  // only when there's a uid but neither an HLS URL (no customer code) nor an MP4.
  const hlsUrl = streamUid && !streamFailed && (streamReady !== false || !src) ? streamHlsUrl(streamUid) : null;
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
      // Unmount mid-play (tab pane swap) → remember the position so the same
      // post resumes seamlessly when its card mounts again.
      savePlaybackPosition(postId, v.currentTime, v.duration);
      releasePlayback(v);
    };
  }, [iframeMode, playIfReady, postId]);

  // Clear pending timers on unmount (no leaks during long scroll sessions).
  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      if (pauseSignTimer.current) clearTimeout(pauseSignTimer.current);
      if (expandTimer.current) clearTimeout(expandTimer.current);
    },
    [],
  );

  const toggleMute = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
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
  //   • single tap   → open the full-screen reels (after a short grace
  //                    window with no follow-up tap — see endHold)
  //   • double tap   → Wow the post (heart burst), stays inline
  //   • press-hold   → pause (while held); release resumes
  // Guarded so a graze, drag, hover, or scroll-tail never triggers any of them.
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
    if (!(started && !moved.current && dur >= 40 && dur < 300 && !recentlyScrolled(500))) return;

    const now = Date.now();
    if (now - lastTapAt.current < 300) {
      // Second tap arrived in time → Wow, not fullscreen.
      lastTapAt.current = 0;
      if (expandTimer.current) clearTimeout(expandTimer.current);
      setBurst((b) => b + 1);
      onDoubleTapLike?.();
      return;
    }
    // Hold the open-fullscreen action briefly in case a second tap follows.
    lastTapAt.current = now;
    if (expandTimer.current) clearTimeout(expandTimer.current);
    expandTimer.current = setTimeout(() => onExpand?.(), 280);
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
      style={{ aspectRatio: ratio ?? 3 / 4 }}
      className={cn(
        "group relative overflow-hidden bg-black",
        // On laptops/desktops the whole video fits the screen height (never taller
        // than 82vh) so you never scroll to see a full clip; phones stay immersive.
        "lg:flex lg:!aspect-auto lg:max-h-[82vh] lg:items-center lg:justify-center",
        className,
      )}
    >
      {/* The promotable box: in-flow normally ("contents" — zero layout cost),
          a fixed edge-to-edge layer in fullscreen. Same element, same <video>,
          so the transition is instant with playback position intact. The outer
          wrapper keeps its size, so the feed never reflows underneath. */}
      <div
        ref={fsBox}
        className={fs ? "fixed inset-0 z-[140] flex items-center justify-center bg-black" : "contents"}
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
          className={cn(
            "h-full w-full",
            // Fullscreen, TikTok-style: a clip whose shape is close to the
            // screen's COVERS it edge-to-edge — video under the status bar and
            // home indicator, no letterbox slivers. Clearly different shapes
            // (landscape on a phone) stay object-contain so nothing meaningful
            // is ever cut off.
            fs &&
              ratio !== null &&
              typeof window !== "undefined" &&
              Math.abs(ratio - window.innerWidth / window.innerHeight) / (window.innerWidth / window.innerHeight) < 0.22
              ? "object-cover"
              : "object-contain",
            fs ? "touch-none" : "touch-pan-y lg:h-auto lg:max-h-[82vh] lg:w-auto",
          )}
          onLoadedMetadata={() => {
            const v = video.current;
            if (!v || !v.videoWidth || !v.videoHeight) return;
            // Exact ratio, clamped: tallest a card goes is full 9:16, widest 16:9.
            setRatio(Math.min(16 / 9, Math.max(9 / 16, v.videoWidth / v.videoHeight)));
            // Resume where this post's video last stopped (tab switch, viewer
            // close, remount) — the feed never "restarts from the top".
            const resumeAt = getPlaybackPosition(postId);
            if (resumeAt !== null && Math.abs(v.currentTime - resumeAt) > 1) v.currentTime = resumeAt;
          }}
          onPause={() => {
            const v = video.current;
            if (v) savePlaybackPosition(postId, v.currentTime, v.duration);
          }}
          onPlay={() => {
            video.current && claimPlayback(video.current);
          }}
          onPlaying={() => {
            setCovered(false);
            if (postId) recordView(postId);
          }}
          onPointerDown={fs ? undefined : onPointerDown}
          onPointerMove={fs ? undefined : onPointerMove}
          onPointerUp={fs ? undefined : endHold}
          onPointerLeave={fs ? undefined : onPointerLeaveCancel}
          onPointerCancel={fs ? undefined : onPointerLeaveCancel}
        />

        {/* Cover — shows the poster until the first frame actually plays, so a
            not-yet-decoded clip never flashes a blank black screen. */}
        {covered && poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={poster} alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full object-contain" />
        ) : null}

        {/* Paused-while-holding indicator */}
        {showPause && !fs ? (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md">
              <Pause className="h-7 w-7 fill-white" />
            </span>
          </span>
        ) : null}

        {/* Inline chrome — hidden in fullscreen (the layer has its own) */}
        {!fs ? (
          <>
            {/* Mute toggle */}
            <button
              type="button"
              onClick={toggleMute}
              aria-label={muted ? "Unmute" : "Mute"}
              className="absolute right-2.5 top-2.5 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md transition hover:bg-black/65"
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>

            {/* Fullscreen */}
            <button
              type="button"
              onClick={enterFs}
              aria-label="Fullscreen"
              className="absolute bottom-2.5 right-2.5 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md transition hover:bg-black/65"
            >
              <Maximize2 className="h-4 w-4" />
            </button>

            {/* Hint */}
            <span className="pointer-events-none absolute bottom-2 left-2.5 z-10 rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-medium text-white/90 opacity-0 backdrop-blur transition-opacity duration-200 group-hover:opacity-100">
              Double-tap to Wow
            </span>

            {/* Double-tap Wow burst — centered (same reliable pattern as the
                paused indicator above), not tap-position-tracked: the video's
                own wrapper is `display: contents` when inline, so it has no
                box of its own to measure a tap position against. */}
            <AnimatePresence>
              {burst > 0 ? (
                <span className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                  <motion.span
                    key={burst}
                    initial={{ opacity: 0, scale: 0.4 }}
                    animate={{ opacity: [0, 1, 1, 0], scale: [0.4, 1.3, 1.1, 1.5] }}
                    transition={{ duration: 0.9, ease: "easeOut", times: [0, 0.2, 0.6, 1] }}
                    className="drop-shadow-[0_2px_10px_rgba(0,0,0,0.5)]"
                  >
                    <WowSolid className="h-20 w-20" />
                  </motion.span>
                </span>
              ) : null}
            </AnimatePresence>
          </>
        ) : (
          <FullscreenVideoLayer
            videoRef={video}
            muted={muted}
            onToggleMute={toggleMute}
            onExit={exitFs}
            onDoubleTapLike={onDoubleTapLike}
          />
        )}
      </div>
    </div>
  );
}
