"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Minimize2,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { WowSolid } from "@/components/brand/wow-icon";
import { cn } from "@/lib/utils";

/**
 * Fullscreen video chrome — the premium, native-app-quality layer that mounts
 * over a video already promoted to a fixed, edge-to-edge box (the SAME <video>
 * element keeps playing, so entering/leaving fullscreen is instant: no reload,
 * no flicker, position preserved by construction).
 *
 * Interaction model (owner spec):
 *  - single tap        → show/hide controls (they also auto-fade after 2.8s)
 *  - double tap center → Wow (like) with a burst
 *  - double tap left / right → seek −10s / +10s with a visual flash
 *  - Space / ← → / M / Esc on keyboards
 * Controls: play/pause, seek bar + times, speed cycle, PiP (where supported),
 * mute, exit. Everything respects safe areas (notch / home indicator).
 *
 * Code-split: this module only loads the first time a user goes fullscreen.
 */

const SPEEDS = [1, 1.25, 1.5, 2, 0.5, 0.75] as const;
const HIDE_AFTER_MS = 2800;
const DOUBLE_TAP_MS = 300;

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function FullscreenVideoLayer({
  videoRef,
  muted,
  onToggleMute,
  onExit,
  onDoubleTapLike,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  muted: boolean;
  onToggleMute: () => void;
  onExit: () => void;
  onDoubleTapLike?: () => void;
}) {
  const [visible, setVisible] = useState(true);
  const [playing, setPlaying] = useState(() => !!videoRef.current && !videoRef.current.paused);
  const [time, setTime] = useState(() => videoRef.current?.currentTime ?? 0);
  const [duration, setDuration] = useState(() => videoRef.current?.duration ?? 0);
  const [speed, setSpeed] = useState(() => videoRef.current?.playbackRate ?? 1);
  const [burst, setBurst] = useState(0);
  const [seekFlash, setSeekFlash] = useState<{ dir: -1 | 1; key: number } | null>(null);

  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const singleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTap = useRef<{ t: number; x: number } | null>(null);
  const downPt = useRef<{ x: number; y: number } | null>(null);

  /* Keep chrome in sync with the (externally owned) video element. */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setTime(v.currentTime);
    const onDur = () => setDuration(v.duration || 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onRate = () => setSpeed(v.playbackRate);
    onDur();
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("durationchange", onDur);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ratechange", onRate);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("durationchange", onDur);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ratechange", onRate);
    };
  }, [videoRef]);

  /* Controls auto-fade. Any interaction restarts the clock. */
  const poke = useCallback(() => {
    setVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), HIDE_AFTER_MS);
  }, []);
  useEffect(() => {
    poke();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (singleTimer.current) clearTimeout(singleTimer.current);
    };
  }, [poke]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
    poke();
  }, [videoRef, poke]);

  const seekBy = useCallback(
    (delta: number) => {
      const v = videoRef.current;
      if (!v || !Number.isFinite(v.duration)) return;
      v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + delta));
      setSeekFlash({ dir: delta < 0 ? -1 : 1, key: Date.now() });
      poke();
    },
    [videoRef, poke],
  );

  const cycleSpeed = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const i = SPEEDS.indexOf(v.playbackRate as (typeof SPEEDS)[number]);
    const next = SPEEDS[(i + 1) % SPEEDS.length] ?? 1;
    v.playbackRate = next;
    poke();
  }, [videoRef, poke]);

  /* Picture-in-Picture — standard API with the iOS Safari fallback. */
  const supportsPip =
    typeof document !== "undefined" &&
    (("pictureInPictureEnabled" in document && (document as Document & { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled) ||
      (!!videoRef.current && "webkitSetPresentationMode" in videoRef.current));
  const togglePip = useCallback(async () => {
    const v = videoRef.current as
      | (HTMLVideoElement & { webkitSetPresentationMode?: (mode: string) => void })
      | null;
    if (!v) return;
    try {
      if (document.pictureInPictureElement === v) {
        await document.exitPictureInPicture();
      } else if (typeof v.requestPictureInPicture === "function") {
        await v.requestPictureInPicture();
        onExit(); // PiP floats over the app — leave fullscreen behind it
      } else if (typeof v.webkitSetPresentationMode === "function") {
        v.webkitSetPresentationMode("picture-in-picture");
        onExit();
      }
    } catch {
      /* PiP declined/unsupported — nothing to clean up */
    }
  }, [videoRef, onExit]);

  /* Keyboard — desktop parity. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
      else if (e.key === " " || e.key === "k") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowLeft") seekBy(-5);
      else if (e.key === "ArrowRight") seekBy(5);
      else if (e.key.toLowerCase() === "m") onToggleMute();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit, togglePlay, seekBy, onToggleMute]);

  /* Tap layer: single = toggle controls · double = like / seek by zone. */
  const onPointerDown = (e: React.PointerEvent) => {
    downPt.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const start = downPt.current;
    downPt.current = null;
    if (!start || Math.abs(e.clientX - start.x) > 12 || Math.abs(e.clientY - start.y) > 12) return;

    const now = Date.now();
    if (lastTap.current && now - lastTap.current.t < DOUBLE_TAP_MS && Math.abs(e.clientX - lastTap.current.x) < 90) {
      if (singleTimer.current) clearTimeout(singleTimer.current);
      lastTap.current = null;
      const rel = e.clientX / window.innerWidth;
      if (rel < 0.33) seekBy(-10);
      else if (rel > 0.67) seekBy(10);
      else {
        setBurst((b) => b + 1);
        onDoubleTapLike?.();
      }
      return;
    }
    lastTap.current = { t: now, x: e.clientX };
    if (singleTimer.current) clearTimeout(singleTimer.current);
    singleTimer.current = setTimeout(() => {
      setVisible((v) => {
        if (!v) poke();
        else if (hideTimer.current) clearTimeout(hideTimer.current);
        return !v;
      });
    }, DOUBLE_TAP_MS - 20);
  };

  const pct = duration > 0 ? (time / duration) * 100 : 0;

  return (
    <div className="absolute inset-0 z-10 select-none" role="group" aria-label="Video controls">
      {/* Gesture surface */}
      <div className="absolute inset-0" onPointerDown={onPointerDown} onPointerUp={onPointerUp} />

      {/* Double-tap Wow burst */}
      <AnimatePresence>
        {burst > 0 ? (
          <motion.span
            key={burst}
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: [0, 1, 1, 0], scale: [0.4, 1.15, 1, 1.2] }}
            transition={{ duration: 0.8, times: [0, 0.2, 0.7, 1] }}
            className="pointer-events-none absolute inset-0 flex items-center justify-center drop-shadow-[0_2px_12px_rgba(0,0,0,0.5)]"
          >
            <WowSolid className="h-28 w-28" />
          </motion.span>
        ) : null}
      </AnimatePresence>

      {/* Seek flash (−10s / +10s) */}
      <AnimatePresence>
        {seekFlash ? (
          <motion.span
            key={seekFlash.key}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: [0, 1, 0], scale: 1 }}
            transition={{ duration: 0.65 }}
            onAnimationComplete={() => setSeekFlash(null)}
            className={cn(
              "pointer-events-none absolute top-1/2 flex -translate-y-1/2 items-center gap-1.5 rounded-full bg-black/55 px-3.5 py-2 text-sm font-semibold text-white backdrop-blur",
              seekFlash.dir < 0 ? "left-[12%]" : "right-[12%]",
            )}
          >
            {seekFlash.dir < 0 ? <RotateCcw className="h-4 w-4" /> : <RotateCw className="h-4 w-4" />}
            {seekFlash.dir < 0 ? "10s" : "10s"}
          </motion.span>
        ) : null}
      </AnimatePresence>

      {/* Big center play (only when paused) */}
      {!playing ? (
        <button
          type="button"
          onClick={togglePlay}
          aria-label="Play"
          className="absolute left-1/2 top-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md transition hover:bg-black/60 active:scale-95"
        >
          <Play className="ml-1 h-9 w-9 fill-white" />
        </button>
      ) : null}

      {/* Top bar */}
      <div
        className={cn(
          "absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/60 to-transparent px-3 pb-8 transition-opacity duration-300",
          visible ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        style={{ paddingTop: "max(env(safe-area-inset-top), 0.75rem)" }}
      >
        <button
          type="button"
          onClick={onExit}
          aria-label="Exit fullscreen"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition hover:bg-black/60"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          {supportsPip ? (
            <button
              type="button"
              onClick={togglePip}
              aria-label="Picture in picture"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition hover:bg-black/60"
            >
              <PictureInPicture2 className="h-5 w-5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? "Unmute" : "Mute"}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition hover:bg-black/60"
          >
            {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Bottom bar — seek + controls, above the home indicator */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-4 pt-10 transition-opacity duration-300",
          visible ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.9rem)" }}
      >
        <div className="mb-2 flex items-center gap-3">
          <span className="w-10 text-right text-[11px] font-medium tabular-nums text-white/90">{formatTime(time)}</span>
          <div className="relative flex-1">
            <input
              type="range"
              min={0}
              max={Math.max(duration, 0.1)}
              step={0.1}
              value={Math.min(time, duration || time)}
              aria-label="Seek"
              onChange={(e) => {
                const v = videoRef.current;
                if (v) v.currentTime = Number(e.target.value);
                poke();
              }}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full accent-white [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
              style={{
                background: `linear-gradient(90deg, #fff ${pct}%, rgba(255,255,255,0.28) ${pct}%)`,
              }}
            />
          </div>
          <span className="w-10 text-[11px] font-medium tabular-nums text-white/90">{formatTime(duration)}</span>
        </div>
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? "Pause" : "Play"}
            className="flex h-10 w-10 items-center justify-center rounded-full text-white transition hover:bg-white/10"
          >
            {playing ? <Pause className="h-6 w-6 fill-white" /> : <Play className="ml-0.5 h-6 w-6 fill-white" />}
          </button>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={cycleSpeed}
              aria-label={`Playback speed ${speed}x`}
              className="rounded-full px-3 py-1.5 text-[13px] font-semibold tabular-nums text-white transition hover:bg-white/10"
            >
              {speed}×
            </button>
            <button
              type="button"
              onClick={onExit}
              aria-label="Exit fullscreen"
              className="flex h-10 w-10 items-center justify-center rounded-full text-white transition hover:bg-white/10"
            >
              <Minimize2 className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
