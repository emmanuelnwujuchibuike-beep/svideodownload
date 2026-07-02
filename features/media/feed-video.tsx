"use client";

import { Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { streamIframeUrl } from "@/lib/media/stream";
import { cn } from "@/lib/utils";

/**
 * Inline feed video (Feature 5 playback). Native uploads get a fully custom,
 * premium player: it autoplays muted when scrolled into view (TikTok/Reels feel),
 * pauses when out of view, and offers tap play/pause, mute, ±10s skip and a
 * scrubbable progress bar. Cloudflare Stream items (iframe) fall back to the
 * Stream player with in-view autoplay (its chrome handles seeking/quality).
 */
function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function FeedVideo({
  src,
  streamUid,
  poster,
  className,
}: {
  src?: string | null;
  streamUid?: string | null;
  poster?: string | null;
  className?: string;
}) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [ready, setReady] = useState(false);
  const [showUi, setShowUi] = useState(true);
  const userPaused = useRef(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iframeMode = !src && !!streamUid;

  const flashUi = useCallback(() => {
    setShowUi(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowUi(false), 2600);
  }, []);

  // In-view autoplay / pause (native player only).
  useEffect(() => {
    if (iframeMode) return;
    const el = wrap.current;
    const v = video.current;
    if (!el || !v) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
          if (!userPaused.current) v.play().catch(() => {});
        } else {
          v.pause();
        }
      },
      { threshold: [0, 0.6, 1] },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [iframeMode]);

  const togglePlay = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) {
      userPaused.current = false;
      v.play().catch(() => {});
    } else {
      userPaused.current = true;
      v.pause();
    }
    flashUi();
  };

  const skip = (delta: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min((v.duration || 0), v.currentTime + delta));
    flashUi();
  };

  const toggleMute = () => {
    const v = video.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    flashUi();
  };

  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = video.current;
    if (!v || !v.duration) return;
    v.currentTime = (Number(e.target.value) / 100) * v.duration;
  };

  if (iframeMode) {
    // Stream player: autoplay muted + loop in the feed; its own controls handle seek.
    return (
      <div ref={wrap} className={cn("relative overflow-hidden bg-black", className)}>
        <iframe
          src={`${streamIframeUrl(streamUid!)}?autoplay=true&muted=true&loop=true`}
          title="Video"
          loading="lazy"
          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
          allowFullScreen
          className="h-full w-full border-0"
        />
      </div>
    );
  }

  if (!src) return null;
  const pct = dur ? (cur / dur) * 100 : 0;

  return (
    <div
      ref={wrap}
      className={cn("group relative overflow-hidden bg-black", className)}
      onMouseMove={flashUi}
      onMouseLeave={() => playing && setShowUi(false)}
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
        className="h-full w-full object-cover"
        onClick={togglePlay}
        onPlay={() => {
          setPlaying(true);
          flashUi();
        }}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(e) => {
          setDur(e.currentTarget.duration || 0);
          setReady(true);
        }}
        onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
      />

      {/* Center play/pause affordance */}
      <button
        type="button"
        onClick={togglePlay}
        aria-label={playing ? "Pause" : "Play"}
        className={cn(
          "absolute inset-0 flex items-center justify-center transition-opacity",
          playing && !showUi ? "opacity-0" : "opacity-100",
        )}
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md transition group-active:scale-90">
          {playing ? <Pause className="h-6 w-6 fill-white" /> : <Play className="h-6 w-6 translate-x-0.5 fill-white" />}
        </span>
      </button>

      {/* Mute — always reachable, top-right */}
      <button
        type="button"
        onClick={toggleMute}
        aria-label={muted ? "Unmute" : "Mute"}
        className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md transition hover:bg-black/65"
      >
        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>

      {/* Bottom control bar */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6 transition-opacity",
          showUi || !playing ? "opacity-100" : "opacity-0",
        )}
      >
        <button type="button" onClick={() => skip(-10)} aria-label="Back 10 seconds" className="text-white/90 transition hover:text-white">
          <RotateCcw className="h-[18px] w-[18px]" />
        </button>
        <button type="button" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"} className="text-white">
          {playing ? <Pause className="h-5 w-5 fill-white" /> : <Play className="h-5 w-5 fill-white" />}
        </button>
        <button type="button" onClick={() => skip(10)} aria-label="Forward 10 seconds" className="text-white/90 transition hover:text-white">
          <RotateCw className="h-[18px] w-[18px]" />
        </button>

        <span className="ml-1 text-[11px] font-medium tabular-nums text-white/90">{fmt(cur)}</span>
        <input
          type="range"
          min={0}
          max={100}
          step={0.1}
          value={ready ? pct : 0}
          onChange={seek}
          aria-label="Seek"
          className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/30 accent-white [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
          style={{ background: `linear-gradient(to right, #fff ${pct}%, rgba(255,255,255,0.3) ${pct}%)` }}
        />
        <span className="text-[11px] font-medium tabular-nums text-white/70">{fmt(dur)}</span>
      </div>
    </div>
  );
}
