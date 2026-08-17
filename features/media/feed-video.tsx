"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Maximize2, Pause, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { WowSolid } from "@/components/brand/wow-icon";
import { useAdaptiveSource } from "@/features/media/use-adaptive-source";
import { clampFeedRatio } from "@/lib/media/aspect";
import { muteInstant, unmuteWithFade } from "@/lib/media/audio-playback";
import { getPlaybackPosition, savePlaybackPosition } from "@/lib/media/resume-positions";
import { streamHlsUrl, streamIframeUrl } from "@/lib/media/stream";
import { claimPlayback, recentlyScrolled, recordView, releasePlayback } from "@/lib/media/video-coordinator";
import { cn } from "@/lib/utils";

// A tap only counts if the pointer barely moved AND the page isn't mid-scroll.
const TAP_MOVE_TOLERANCE = 18;

/**
 * Inline feed video. Autoplays muted when scrolled into view (Reels feel) and
 * pauses when out of view.
 *
 * Interaction (same on every device): a deliberate tap/click, or the explicit
 * expand button, opens the fullscreen reel — heavily guarded so a tap on the
 * clip itself never fires on a graze, drag, hover, or the tail of a scroll.
 * Press-and-hold pauses while held (and never opens). A mute toggle is always
 * reachable. Cloudflare Stream items fall back to the Stream player.
 */
/**
 * The clip's true aspect ratio — see `lib/media/aspect.ts`'s 2026-08-17
 * reversal note (it no longer CLAMPS anything, despite the name; a `max-h`
 * safety net on the actual elements below is what limits tallness now).
 * Kept as a local alias, not renamed, purely to avoid rippling the change
 * through every call site in this file for a cosmetic reason.
 */
const clampRatio = clampFeedRatio;

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
  width,
  height,
  children,
}: {
  /**
   * The clip's natural pixel size, when the server knows it (`posts.media_width`
   * / `media_height`).
   *
   * 🔴 Supplying this is what makes the card the EXACT height of the video from
   * the first paint. Without it the box has to guess until `loadedmetadata`
   * fires — and that only happens once the card is near the viewport, so a
   * landscape clip spent its whole time off-screen, and a moment on-screen, in a
   * 3:4 box with black bars top and bottom. Optional, because older posts have
   * no stored dimensions; those still measure themselves as before.
   */
  width?: number | null;
  height?: number | null;
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
  /**
   * Overlay content (e.g. a views/duration badge) positioned relative to
   * THIS component's own box — not the caller's outer wrapper. 2026-08-17: a
   * badge rendered as a SIBLING in feed-post-card.tsx, absolutely positioned
   * against that outer wrapper, floated away from the actual clip once this
   * box could be narrower than its wrapper (the max-h-45vh cap centering a
   * tall/portrait video). Passing it in here instead means it's always
   * anchored to the real, possibly-narrower media box.
   */
  children?: React.ReactNode;
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
  // cropped or letterboxed. The `max-h-[45vh]`/`lg:max-h-[82vh]` safety net
  // below is the only ceiling on tallness.
  //
  // Seeded from the SERVER's stored dimensions when they exist, so the box is
  // the right shape before a single byte of video is fetched; measured from the
  // element on `loadedmetadata` otherwise. Same function on both paths, so the
  // two cannot disagree and resize the card for no reason.
  const [ratio, setRatio] = useState<number | null>(() => clampRatio(width, height));
  const inViewRef = useRef(false);
  const readyRef = useRef(false);

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
        {children}
      </div>
    );
  }

  if (!hasNative) return null;

  return (
    <div
      ref={wrap}
      // The "we don't know yet" placeholder — before metadata (or a
      // server-known width/height) arrives, 4/5 is just a reasonable guess,
      // never a ceiling applied to a KNOWN ratio (see aspect.ts's 2026-08-17
      // reversal note — `ratio` itself is the media's true, unclamped shape).
      style={{ aspectRatio: ratio ?? 4 / 5 }}
      className={cn(
        // `mx-auto` + its own `rounded-2xl`: once the max-h cap narrows this
        // box below the card's full width, it needs to center itself and carry
        // its own rounded corners — the outer wrapper's rounding only reaches
        // the card's own edges, which this box no longer touches in that case
        // (owner, 2026-08-17: "there are still black side background… the
        // single videos still stretch a lot" — a forced `w-full` on the caller
        // side used to fight this box's own aspect-ratio/max-h sizing; fixed by
        // dropping that override, see feed-post-card.tsx).
        "group relative mx-auto overflow-hidden rounded-2xl bg-black",
        // Twitter-style: full width, the media's OWN true aspect ratio — a
        // HEIGHT ceiling, never a ratio clamp, so it can't disagree with the
        // clip's true shape (no letterboxing). Retightened 2026-08-17
        // (70vh→45vh, owner: "post should not be that long… skrinked so two
        // post can show on one screenview") after the owner's own screenshots
        // showed 70vh was still occupying most of the viewport for a single
        // portrait clip — this DOES actively trigger on ordinary tall/
        // portrait content now, by design, not just on pathological uploads.
        "max-h-[45vh] lg:flex lg:!aspect-auto lg:max-h-[82vh] lg:items-center lg:justify-center",
        className,
      )}
    >
      {/*
        🔴 BLURRED BACKDROP (owner, 2026-08-17: "the feed card shows the black
        side background for a second each time i enter the feed page"). Real
        cause: this wrapper's shape starts from a GUESS — either the `4/5`
        fallback (no stored dims yet) or a seeded `width`/`height` that can
        still differ slightly from what `onLoadedMetadata` later measures —
        so there's a brief window where the box doesn't yet match the clip's
        true shape. `FeedImage` already solves the identical problem with a
        blurred, scaled `object-cover` copy of its own image filling that gap
        instead of showing raw black; this is the same fix, using the
        `poster` frame this component already has on hand. Once the box
        resizes to the correct ratio, this is fully covered and invisible.
      */}
      {poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={poster}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 h-full w-full scale-110 object-cover opacity-30 blur-2xl"
        />
      ) : null}

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
        /*
          🔴 NO press or hover transform on the clip (owner, 2026-08-11: "like
          videos be fixed in position even if they were press and hold, to avoid
          movement of the video during press and hold or hover").

          It used to carry `active:scale-[0.985]`, added as generic "lift on
          touch" press feedback. That is the right instinct for a BUTTON and the
          wrong one here, because on this element press-and-hold is a real,
          sustained gesture — it pauses playback — so the scale was not a
          momentary tap flash: the video shrank and SAT there, visibly smaller,
          for as long as a finger rested on it. Playing video is the one thing on
          the page whose stillness is load-bearing, and the pause indicator
          already gives the gesture unambiguous feedback.
        */
        className="h-full max-h-[45vh] w-full touch-pan-y object-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset lg:h-auto lg:max-h-[82vh] lg:w-auto"
        // Keyboard access (owner spec, 2026-08-17: "Keyboard users can still
        // open media") — purely additive: Enter/Space opens directly,
        // bypassing the tap/double-tap/hold pointer state machine above
        // entirely rather than routing through it, since there's no
        // keyboard analog for "hold" or "double-press" here. Wow already has
        // its own independent, keyboard-reachable button in the action row.
        role="button"
        tabIndex={0}
        aria-label="Open video"
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          onExpand?.();
        }}
        onLoadedMetadata={() => {
          const v = video.current;
          if (!v || !v.videoWidth || !v.videoHeight) return;
          // The clip's real, unclamped ratio — the element is the authority
          // here (a stored dimension can be stale or wrong, and by now we
          // have the real thing); tallness is bounded only by the max-h
          // safety net on the wrapper/element, not by this value.
          setRatio(clampRatio(v.videoWidth, v.videoHeight));
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
        <img src={poster} alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full object-contain" />
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

      {/* Expand — the same fullscreen reel a tap on the clip itself opens
          (owner spec: one consistent "zoom" behavior, not a second,
          separate in-place fullscreen mode). */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onExpand?.();
        }}
        aria-label="Open in fullscreen"
        className="absolute bottom-2.5 right-2.5 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md transition hover:bg-black/65"
      >
        <Maximize2 className="h-4 w-4" />
      </button>

      {/* Hint */}
      <span className="pointer-events-none absolute bottom-2 left-2.5 z-10 rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-medium text-white/90 opacity-0 backdrop-blur transition-opacity duration-200 group-hover:opacity-100">
        Double-tap to Wow
      </span>

      {/* Double-tap Wow burst — centered (same reliable pattern as the
          paused indicator above), not tap-position-tracked. */}
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

      {children}
    </div>
  );
}
