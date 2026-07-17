"use client";

import { Pause, Play, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { fmtDuration } from "@/lib/media/comment-recording";
import { cn } from "@/lib/utils";

const SPEEDS = [1, 1.5, 2] as const;

/** A voice-note bubble — waveform scrubber (tap to seek), play/pause, speed cycle. */
export function VoiceMessage({ url, durationMs, waveform }: { url: string; durationMs: number | null; waveform: number[] | null }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const barsRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [curMs, setCurMs] = useState(0);
  const [speedIdx, setSpeedIdx] = useState(0);

  const peaks = waveform && waveform.length ? waveform : Array.from({ length: 32 }, () => 28);
  const maxPeak = Math.max(1, ...peaks);
  const totalMs = durationMs ?? 0;

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };
  const cycleSpeed = () => {
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    if (ref.current) ref.current.playbackRate = SPEEDS[next]!;
  };
  const seekAt = (clientX: number) => {
    const el = ref.current;
    const bar = barsRef.current;
    if (!el || !bar || !el.duration) return;
    const r = bar.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    el.currentTime = pct * el.duration;
  };

  return (
    <div className="mt-1.5 flex items-center gap-2 rounded-2xl border border-border/50 bg-secondary/30 px-3 py-2">
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-sm shadow-violet-500/30"
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={ref}
        src={url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          setCurMs(el.currentTime * 1000);
          if (el.duration) setProgress(el.currentTime / el.duration);
        }}
        className="hidden"
      />
      <div
        ref={barsRef}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        tabIndex={0}
        onClick={(e) => seekAt(e.clientX)}
        onKeyDown={(e) => {
          const el = ref.current;
          if (!el || !el.duration) return;
          if (e.key === "ArrowRight") el.currentTime = Math.min(el.duration, el.currentTime + 3);
          if (e.key === "ArrowLeft") el.currentTime = Math.max(0, el.currentTime - 3);
        }}
        className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-[2px] overflow-hidden"
      >
        {peaks.map((p, i) => (
          <span
            key={i}
            className={cn("min-w-[1px] flex-1 rounded-full transition-colors", i / peaks.length <= progress ? "bg-gradient-to-b from-blue-500 to-violet-500" : "bg-border")}
            style={{ height: `${Math.max(12, (p / maxPeak) * 100)}%` }}
          />
        ))}
      </div>
      <span className="shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">
        {fmtDuration(playing || curMs > 0 ? curMs : totalMs)}
      </span>
      <button type="button" onClick={cycleSpeed} aria-label="Playback speed" className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground transition hover:text-foreground">
        {SPEEDS[speedIdx]}×
      </button>
    </div>
  );
}

/** A short video-reply — muted poster preview inline, tap opens a fullscreen player with sound. */
export function VideoComment({
  url,
  thumbnailUrl,
  durationMs,
  width,
  height,
}: {
  url: string;
  thumbnailUrl: string | null;
  durationMs: number | null;
  /** Intrinsic size of the SOURCE VIDEO — the poster is a frame of it, so it
   *  shares the aspect ratio. Reserves the box before the poster loads. */
  width?: number | null;
  height?: number | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Play video reply" className="group relative mt-1.5 block max-h-64 w-fit max-w-full overflow-hidden rounded-2xl border border-border/60 bg-black">
        {thumbnailUrl ? (
          // max-w-full: a landscape clip capped only by max-h-64 (height) would
          // otherwise render wider than a phone screen at 16:9 (256px tall ×
          // 16/9 ≈ 455px wide) — width now yields to the viewport instead.
          //
          // width/height are LOAD-BEARING (owner, 2026-07-17, with a screenshot
          // of a thread opening mid-conversation): without them this poster
          // reserves ZERO height until it decodes, then snaps to full height and
          // shoves the thread down — after the scroll-to-bottom has already run.
          // The image bubbles were given their dimensions; this one was missed,
          // and `loading="lazy"` made it worse (a poster below the fold doesn't
          // even START loading until scrolled toward, so the shift lands late).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailUrl}
            alt=""
            loading="lazy"
            width={width ?? undefined}
            height={height ?? undefined}
            className="max-h-64 w-auto max-w-full object-cover"
          />
        ) : (
          // No uploaded thumbnail — show the video's OWN first frame rather
          // than a black rectangle (owner, 2026-07-16: "videos sent in chat
          // should always [have] a cover image of the starting of the video").
          //
          // `#t=0.1` is the load-bearing part: a bare `<video preload="metadata">`
          // fetches dimensions/duration but renders NOTHING until a frame is
          // decoded, so it sits black. A media-fragment start time makes the
          // browser seek there and paint that frame as the poster — the same
          // trick the stories row already uses for its video covers (`#t=0.3`).
          // 0.1s, not 0: some encoders' frame at exactly 0 is black/absent.
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            src={`${url}#t=0.1`}
            muted
            playsInline
            preload="metadata"
            className="max-h-64 w-auto max-w-full object-cover"
          />
        )}
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/15 transition group-hover:bg-black/30">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md">
            <Play className="h-5 w-5 fill-white" />
          </span>
        </span>
        {durationMs ? (
          <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">{fmtDuration(durationMs)}</span>
        ) : null}
      </button>
      {open ? <VideoLightbox src={url} poster={thumbnailUrl} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function VideoLightbox({ src, poster, onClose }: { src: string; poster: string | null; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    // overflowY only — the `overflow` shorthand also resets overflow-x, undoing
    // the `overflow-x: clip` on <body> that keeps the app sidebar sticky.
    const prev = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflowY = prev;
    };
  }, [onClose]);

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Video reply" onClick={onClose} className="fixed inset-0 z-[120] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm">
      <button type="button" onClick={onClose} aria-label="Close" className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20">
        <X className="h-5 w-5" />
      </button>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video src={src} poster={poster ?? undefined} controls autoPlay playsInline onClick={(e) => e.stopPropagation()} className="max-h-[90vh] max-w-full rounded-xl object-contain shadow-2xl" />
    </div>,
    document.body,
  );
}
