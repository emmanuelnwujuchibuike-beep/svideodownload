"use client";

import { Bookmark, Music2, Pause, Play, Video } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { VerifiedTick } from "@/components/badges/identity-badges";
import { toast } from "@/features/ui/toast";
import { fmtDuration } from "@/lib/media/comment-recording";
import { reelsLabel } from "@/lib/social/sound-library-shared";
import { cn, formatCompactNumber } from "@/lib/utils";

/**
 * The Sound Page's hero — design/frenz-sounds.html's dark "featured" card (owner, 2026-10-30: "I still see the old sound
 * page"), for one sound: its cover, title and creator, the real counts, the tap-to-seek waveform player (the same
 * pattern as `comment-media.tsx`'s VoiceMessage — real decoded amplitude when the sound has it, flat bars when it
 * doesn't, never an invented waveform), and its two actions: Use this sound, and Save.
 *
 * 🔴 Never autoplays, on mount or otherwise. `lib/media/audio-playback.ts` documents a hard rule for this app: audio
 * focus is taken ONLY on an explicit tap, so a visitor's own music/podcast isn't interrupted just by landing on a page.
 * A play is only ever recorded once this player is actually tapped to start — never on load.
 */
export function SoundHero({
  soundId,
  label,
  title,
  artistLabel,
  verified,
  coverArtUrl,
  audioUrl,
  waveformPeaks,
  durationSec,
  usageCount,
  playsCount,
}: {
  soundId: string;
  /** The card's eyebrow: "Original audio", or a downloaded sound's credit ("From TikTok"). */
  label: string;
  title: string;
  artistLabel: string;
  verified: boolean;
  coverArtUrl: string | null;
  audioUrl: string;
  waveformPeaks: number[];
  durationSec: number;
  usageCount: number;
  playsCount: number;
}) {
  const router = useRouter();
  const ref = useRef<HTMLAudioElement | null>(null);
  const barsRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [curMs, setCurMs] = useState(0);
  const playRecorded = useRef(false);

  const peaks = waveformPeaks.length ? waveformPeaks : Array.from({ length: 40 }, () => 18);
  const maxPeak = Math.max(1, ...peaks);
  // an original sound (0308) may carry no stored length: the file's own, once its metadata loads
  const [measuredSec, setMeasuredSec] = useState(0);
  const totalMs = (durationSec || measuredSec) * 1000;

  // Save (0308 sound_saves) — whether this member saved it, and whether anyone is signed in
  const [saved, setSaved] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/sounds/saves")
      .then((r) => r.json())
      .then((j: { ids?: string[]; signedIn?: boolean }) => {
        if (cancelled) return;
        setSignedIn(!!j.signedIn);
        setSaved((j.ids ?? []).includes(soundId));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [soundId]);

  const toggleSave = async () => {
    if (signedIn === false) return router.push(`/login?next=${encodeURIComponent(`/sound/${soundId}`)}`);
    const next = !saved;
    setSaved(next);
    const res = await fetch("/api/sounds/saves", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ soundId, saved: next }) }).catch(() => null);
    if (!res?.ok) {
      setSaved(!next);
      toast(res?.status === 401 ? "Sign in to save sounds." : "Couldn't save that sound.", "error");
    }
  };

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
    <section aria-label={title} className="flex flex-col gap-[18px] rounded-3xl bg-zinc-950 p-5 text-white">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-violet-300">{label}</span>
        <span className="shrink-0 text-xs text-zinc-400">
          {reelsLabel(usageCount)} · {formatCompactNumber(playsCount)} {playsCount === 1 ? "play" : "plays"}
        </span>
      </div>

      <div className="flex items-center gap-3.5">
        <span className="flex h-[76px] w-[76px] shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-indigo-950">
          {coverArtUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- the sound's own cover on our media host
            <img src={coverArtUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <Music2 className="h-[30px] w-[30px] text-violet-300" aria-hidden />
          )}
        </span>
        <span className="min-w-0">
          <h1 className="truncate text-xl font-bold tracking-[-0.01em]">{title}</h1>
          <span className="mt-1 flex items-center gap-1.5 text-sm text-zinc-300">
            <span className="truncate">{artistLabel}</span>
            {verified ? <VerifiedTick size="sm" /> : null}
          </span>
        </span>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={toggle} aria-label={playing ? "Pause" : "Play"} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-zinc-950 transition active:scale-95">
          {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
        </button>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio
          ref={ref}
          src={audioUrl}
          preload="metadata"
          onLoadedMetadata={(e) => setMeasuredSec(Number.isFinite(e.currentTarget.duration) ? Math.round(e.currentTarget.duration) : 0)}
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
          className="flex h-10 min-w-0 flex-1 cursor-pointer items-center gap-[3px] overflow-hidden"
        >
          {peaks.map((p, i) => (
            <span
              key={i}
              className={cn("min-w-[2px] flex-1 rounded-sm transition-colors", i / peaks.length <= progress && (playing || curMs > 0) ? "bg-violet-300" : "bg-zinc-700")}
              style={{ height: `${Math.max(10, (p / maxPeak) * 100)}%` }}
            />
          ))}
        </div>
        <span className="shrink-0 text-xs font-semibold tabular-nums text-zinc-400">{fmtDuration(playing || curMs > 0 ? curMs : totalMs)}</span>
      </div>

      <div className="flex gap-2.5">
        {/* "Use this sound" — the reel composer, pre-seeded via ?sound= (reel-composer.tsx); the sound then REPLACES
            the reel's own audio (0308) */}
        <a href={`/create/reel?sound=${soundId}`} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-[14px] bg-frenz-violet text-[15px] font-bold text-white transition active:scale-[0.99]">
          <Video className="h-[18px] w-[18px]" aria-hidden />
          Use this sound
        </a>
        <button type="button" onClick={() => void toggleSave()} aria-label={saved ? "Unsave sound" : "Save sound"} aria-pressed={saved} className="flex h-12 w-12 items-center justify-center rounded-[14px] border border-zinc-700 transition active:scale-95">
          <Bookmark className={cn("h-[18px] w-[18px]", saved && "fill-white")} />
        </button>
      </div>
    </section>
  );
}
