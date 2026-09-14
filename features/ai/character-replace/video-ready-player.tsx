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
}

export const VideoReadyPlayer = forwardRef<
  VideoReadyPlayerHandle,
  {
    src: string | null;
    poster: string | null;
    /** For the fullscreen title and assistive tech. */
    title: string;
    onReady?: () => void;
    className?: string;
  }
>(function VideoReadyPlayer({ src, poster, title, onReady, className }, ref) {
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

  useImperativeHandle(ref, () => ({ enterFullscreen: () => void toggleFullscreen() }), [toggleFullscreen]);

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
          <IconButton label={muted ? "Unmute" : "Mute"} onClick={toggleMute} disabled={!ready}>
            {muted ? <VolumeX className="h-5 w-5" aria-hidden /> : <Volume2 className="h-5 w-5" aria-hidden />}
          </IconButton>
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
