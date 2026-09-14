"use client";

import { Loader2, Maximize2, Minimize2, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE VIEWER — the finished video, large, on black, with the controls it needs
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Video Ready brief (owner, 2026-09-14): "large immersive video player,
 * correct aspect ratio, black/neutral cinematic surrounding area, clean
 * controls — play/pause, seek, volume, fullscreen, playback state, loading
 * state, poster while loading. On mobile the video should use as much
 * available screen space as reasonably possible."
 *
 * ── One `<video>`, one URL, no copies ───────────────────────────────────────
 * The element plays the signed preview URL directly (`preload="metadata"`);
 * the poster is the job's own still (`/api/ai/jobs/<id>/poster`). Nothing is
 * fetched into memory until the member presses Download or Share, and those
 * live in the parent. No CSS `filter` anywhere near the frame: what the
 * decoder produces is what is shown.
 *
 * ── Fullscreen, honestly ────────────────────────────────────────────────────
 * Where the Fullscreen API exists (Android Chrome, desktop) the CONTAINER
 * goes fullscreen, so the video keeps its aspect on black and these controls
 * stay usable, padded by the safe-area insets. iOS Safari exposes no element
 * fullscreen for a div; there the video's own `webkitEnterFullscreen()`
 * opens the native viewer, which handles rotation, the notch and exit on its
 * own. Exiting either way lands back on this screen with the same position.
 *
 * ── Keyboard ────────────────────────────────────────────────────────────────
 * Space / K play-pause, ← → seek 5 s, M mute, F fullscreen — on the viewer
 * itself, which is focusable. Every button has a label.
 */
export interface VideoReadyPlayerHandle {
  enterFullscreen: () => void;
  /** Part 7 §5: the playhead, so a source swap (Original ↔ Character Replace) resumes at the same second. */
  currentTime: () => number;
  /** Part 7 §3: pause without a tap (used when the page swaps sources or leaves). */
  pause: () => void;
}

/** Playback speeds offered (§3). Cycled by one button; the label is the rate. */
const SPEEDS = [1, 1.5, 2, 0.5] as const;

export const VideoReadyPlayer = forwardRef<
  VideoReadyPlayerHandle,
  {
    src: string | null;
    poster: string | null;
    /** For the fullscreen title and assistive tech. */
    title: string;
    onReady?: () => void;
    /** Fired on the FIRST play of a source — the analytics moment (§33), never a URL. */
    onFirstPlay?: () => void;
    /** A chip over the top-left corner: "Original" / "Character Replace" in comparison mode (§5). */
    badge?: string | null;
    /** Part 7 §3: a speed control, where appropriate (off inside comparison, where two clips must stay in step). */
    speedControl?: boolean;
    className?: string;
  }
>(function VideoReadyPlayer({ src, poster, title, onReady, onFirstPlay, badge = null, speedControl = true, className }, ref) {
  const box = useRef<HTMLDivElement | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [muted, setMuted] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsShown, setControlsShown] = useState(true);
  const hideTimer = useRef<number | null>(null);
  const [aspect, setAspect] = useState<number | null>(null);
  const [volume, setVolume] = useState(1);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const playedOnce = useRef(false);
  /*
    Part 7 §5: when `src` changes (comparison mode) the element keeps its
    place — the playhead is remembered here and restored on the new
    source's `loadedmetadata`, so Original and Character Replace can be
    flipped at the same second. Muted state and speed carry over too.
  */
  const resumeAt = useRef<number | null>(null);
  const lastSrc = useRef<string | null>(src);
  useEffect(() => {
    if (lastSrc.current !== src) {
      const v = video.current;
      resumeAt.current = v ? v.currentTime : null;
      lastSrc.current = src;
      setReady(false);
      playedOnce.current = false;
    }
  }, [src]);

  const showControls = useCallback(() => {
    setControlsShown(true);
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      const v = video.current;
      if (v && !v.paused) setControlsShown(false);
    }, 2600);
  }, []);

  useEffect(() => {
    return () => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    };
  }, []);

  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
    showControls();
  }, [showControls]);

  const seekBy = useCallback((delta: number) => {
    const v = video.current;
    if (!v || !Number.isFinite(v.duration)) return;
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + delta));
  }, []);

  const toggleMute = useCallback(() => {
    const v = video.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = box.current;
    const v = video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void; webkitSupportsFullscreen?: boolean }) | null;
    if (!el || !v) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
      return;
    }
    if (typeof el.requestFullscreen === "function") {
      try {
        await el.requestFullscreen({ navigationUI: "hide" });
        return;
      } catch {
        /* fall through to the video's own viewer */
      }
    }
    // iOS Safari: the native viewer is the only fullscreen there is, and it is a good one.
    if (typeof v.webkitEnterFullscreen === "function") v.webkitEnterFullscreen();
  }, []);

  const cycleSpeed = useCallback(() => {
    const v = video.current;
    const i = SPEEDS.indexOf(speed);
    const next = SPEEDS[(i + 1) % SPEEDS.length]!;
    setSpeed(next);
    if (v) v.playbackRate = next;
    showControls();
  }, [showControls, speed]);

  const setVolumeTo = useCallback((value: number) => {
    const v = video.current;
    const clamped = Math.max(0, Math.min(1, value));
    setVolume(clamped);
    if (v) {
      v.volume = clamped;
      if (clamped > 0 && v.muted) v.muted = false;
    }
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      enterFullscreen: () => void toggleFullscreen(),
      currentTime: () => video.current?.currentTime ?? 0,
      pause: () => video.current?.pause(),
    }),
    [toggleFullscreen],
  );

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement && document.fullscreenElement === box.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      switch (e.key) {
        case " ":
        case "k":
        case "K":
          e.preventDefault();
          toggle();
          break;
        case "ArrowLeft":
          e.preventDefault();
          seekBy(-5);
          break;
        case "ArrowRight":
          e.preventDefault();
          seekBy(5);
          break;
        case "m":
        case "M":
          toggleMute();
          break;
        case "f":
        case "F":
          void toggleFullscreen();
          break;
      }
    },
    [seekBy, toggle, toggleFullscreen, toggleMute],
  );

  const portrait = aspect !== null && aspect < 1;

  return (
    <div
      ref={box}
      tabIndex={0}
      role="region"
      aria-label={`${title} player`}
      onKeyDown={onKey}
      onPointerMove={showControls}
      onPointerDown={showControls}
      className={cn(
        "group relative w-full select-none overflow-hidden bg-black outline-none focus-visible:ring-2 focus-visible:ring-primary/70",
        fullscreen ? "flex h-full w-full items-center justify-center rounded-none" : "rounded-[1.25rem]",
        className,
      )}
      style={
        fullscreen
          ? { paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)", paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }
          : undefined
      }
    >
      {/*
        The frame: portrait video gets the height a phone can give it (up to
        ~72vh), landscape sits at its own ratio. `object-contain` on black —
        never a crop, never a stretch.
      */}
      <div
        className={cn("relative mx-auto flex w-full items-center justify-center", fullscreen ? "h-full" : portrait ? "max-h-[72svh]" : "")}
        style={!fullscreen && aspect !== null ? { aspectRatio: String(aspect) } : !fullscreen ? { aspectRatio: "16 / 9" } : undefined}
      >
        {src ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption -- a generated video has no caption track
          <video
            ref={video}
            src={src}
            poster={poster ?? undefined}
            playsInline
            preload="metadata"
            controls={false}
            className={cn("block h-full w-full object-contain", fullscreen ? "max-h-full" : "")}
            onClick={toggle}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight);
              setDuration(Number.isFinite(v.duration) ? v.duration : 0);
              v.playbackRate = speed;
              v.volume = volume;
              if (resumeAt.current !== null && Number.isFinite(v.duration)) {
                v.currentTime = Math.min(resumeAt.current, Math.max(0, v.duration - 0.05));
                resumeAt.current = null;
              }
            }}
            onCanPlay={() => {
              setReady(true);
              setWaiting(false);
              onReady?.();
            }}
            onWaiting={() => setWaiting(true)}
            onPlaying={() => {
              setWaiting(false);
              setPlaying(true);
              showControls();
              if (!playedOnce.current) {
                playedOnce.current = true;
                onFirstPlay?.();
              }
            }}
            onPause={() => {
              setPlaying(false);
              setControlsShown(true);
            }}
            onEnded={() => setControlsShown(true)}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center" style={poster ? { backgroundImage: `url(${poster})`, backgroundSize: "contain", backgroundPosition: "center", backgroundRepeat: "no-repeat" } : undefined} />
        )}

        {badge ? (
          <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-white backdrop-blur-sm" aria-live="polite">
            {badge}
          </span>
        ) : null}

        {/* loading / buffering */}
        {(!src || !ready || waiting) && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25" role="status" aria-live="polite">
            <Loader2 className="h-7 w-7 animate-spin text-white/90 motion-reduce:animate-none" aria-hidden />
            <span className="sr-only">{!src ? "Preparing your video" : "Loading your video"}</span>
          </div>
        )}

        {/* the big play — only while paused and ready */}
        {src && ready && !playing && !waiting ? (
          <button
            type="button"
            onClick={toggle}
            aria-label="Play"
            className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/92 text-black shadow-[0_10px_30px_-10px_rgba(0,0,0,0.6)] backdrop-blur-sm transition active:scale-95"
          >
            <Play className="ml-1 h-7 w-7" fill="currentColor" aria-hidden />
          </button>
        ) : null}
      </div>

      {/* controls */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 flex flex-col gap-1.5 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-3 pb-2.5 pt-8 text-white transition-opacity duration-200",
          controlsShown || !playing ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
        style={fullscreen ? { paddingBottom: "max(0.625rem, env(safe-area-inset-bottom))" } : undefined}
      >
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.05}
          value={Math.min(time, duration || 0)}
          onChange={(e) => {
            const v = video.current;
            if (v) v.currentTime = Number(e.currentTarget.value);
          }}
          aria-label="Seek"
          aria-valuetext={`${fmt(time)} of ${fmt(duration)}`}
          className="frenz-range h-1.5 w-full cursor-pointer accent-white"
          disabled={!ready}
        />
        <div className="flex items-center gap-1">
          <IconButton label={playing ? "Pause" : "Play"} onClick={toggle} disabled={!ready}>
            {playing ? <Pause className="h-5 w-5" fill="currentColor" aria-hidden /> : <Play className="ml-0.5 h-5 w-5" fill="currentColor" aria-hidden />}
          </IconButton>
          <span className="ml-1 text-[12px] font-semibold tabular-nums text-white/90" aria-live="off">
            {fmt(time)} <span className="text-white/50">/ {fmt(duration)}</span>
          </span>
          <span className="flex-1" />
          {speedControl ? (
            <button
              type="button"
              onClick={cycleSpeed}
              disabled={!ready}
              aria-label={`Playback speed ${speed}×, press to change`}
              title="Playback speed"
              className="flex h-10 min-w-[2.75rem] items-center justify-center rounded-full px-2 text-[12px] font-bold tabular-nums text-white transition hover:bg-white/15 active:scale-95 disabled:opacity-40"
            >
              {speed}×
            </button>
          ) : null}
          <IconButton label={muted ? "Unmute" : "Mute"} onClick={toggleMute} disabled={!ready}>
            {muted ? <VolumeX className="h-5 w-5" aria-hidden /> : <Volume2 className="h-5 w-5" aria-hidden />}
          </IconButton>
          {/* a volume slider where there is a pointer to drag it; phones use their own buttons */}
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(e) => setVolumeTo(Number(e.currentTarget.value))}
            aria-label="Volume"
            aria-valuetext={`${Math.round((muted ? 0 : volume) * 100)}%`}
            disabled={!ready}
            className="frenz-range hidden h-1.5 w-20 cursor-pointer accent-white sm:block"
          />
          <IconButton label={fullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={() => void toggleFullscreen()} disabled={!src}>
            {fullscreen ? <Minimize2 className="h-5 w-5" aria-hidden /> : <Maximize2 className="h-5 w-5" aria-hidden />}
          </IconButton>
        </div>
      </div>
    </div>
  );
});

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-10 w-10 items-center justify-center rounded-full text-white transition hover:bg-white/15 active:scale-95 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}
