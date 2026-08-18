"use client";

import { Music, Pause, Play } from "lucide-react";
import { useRef, useState } from "react";

import { fmtDuration } from "@/lib/media/comment-recording";
import { cn, formatCompactNumber } from "@/lib/utils";

/**
 * The Sound Page's hero player — the same waveform-scrubber pattern
 * `comment-media.tsx`'s `VoiceMessage` already ships (tap-to-seek bars, real
 * decoded amplitude), generalized with cover art and stats.
 *
 * 🔴 Never autoplays, on mount or otherwise. `lib/media/audio-playback.ts`
 * documents a hard rule for this app: audio focus is taken ONLY on an
 * explicit tap, specifically so a visitor's own music/podcast isn't
 * interrupted just by landing on a page. A play is only ever recorded once
 * this player is actually tapped to start — never on load.
 */
export function SoundHero({
  soundId,
  title,
  artistLabel,
  coverArtUrl,
  audioUrl,
  waveformPeaks,
  durationSec,
  usageCount,
  playsCount,
  attribution,
}: {
  soundId: string;
  title: string;
  artistLabel: string;
  coverArtUrl: string | null;
  audioUrl: string;
  waveformPeaks: number[];
  durationSec: number;
  usageCount: number;
  playsCount: number;
  /** "From TikTok" / "From Instagram" — set only for a downloaded, attributed sound. */
  attribution: string | null;
}) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const barsRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [curMs, setCurMs] = useState(0);
  const playRecorded = useRef(false);

  const peaks = waveformPeaks.length ? waveformPeaks : Array.from({ length: 48 }, () => 28);
  const maxPeak = Math.max(1, ...peaks);
  const totalMs = durationSec * 1000;

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) {
      void el.play();
      if (!playRecorded.current) {
        playRecorded.current = true;
        void fetch(`/api/sounds/${soundId}/play`, { method: "POST" }).catch(() => {});
      }
    } else {
      el.pause();
    }
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
    <div className="overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-b from-card/80 to-card/40 p-5 shadow-soft ring-1 ring-inset ring-white/5 backdrop-blur">
      <div className="flex items-start gap-4">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 to-violet-700 shadow-lg">
          {coverArtUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverArtUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-white/80">
              <Music className="h-8 w-8" />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold tracking-[-0.02em]">{title}</h1>
          <p className="mt-1 truncate text-sm text-muted-foreground">{artistLabel}</p>
          {attribution ? (
            <span className="mt-1.5 inline-flex items-center rounded-full bg-secondary/60 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {attribution}
            </span>
          ) : null}
          <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
            <span>{formatCompactNumber(usageCount)} reels</span>
            <span aria-hidden>·</span>
            <span>{formatCompactNumber(playsCount)} plays</span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-md shadow-violet-500/30 transition active:scale-95"
        >
          {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
        </button>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio
          ref={ref}
          src={audioUrl}
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
          className="flex h-10 min-w-0 flex-1 cursor-pointer items-center gap-[2px] overflow-hidden"
        >
          {peaks.map((p, i) => (
            <span
              key={i}
              className={cn(
                "min-w-[1.5px] flex-1 rounded-full transition-colors",
                i / peaks.length <= progress ? "bg-gradient-to-b from-blue-500 to-violet-500" : "bg-border",
              )}
              style={{ height: `${Math.max(14, (p / maxPeak) * 100)}%` }}
            />
          ))}
        </div>
        <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
          {fmtDuration(playing || curMs > 0 ? curMs : totalMs)}
        </span>
      </div>
    </div>
  );
}
