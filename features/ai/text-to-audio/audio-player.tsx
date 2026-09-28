"use client";

import { Download, Loader2, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { audioDownloadHref, getAudioAssetUrl } from "@/lib/ai/text-to-audio/client";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * One saved audio, played in place.
 *
 * The URL is signed and short-lived, so it is fetched on the FIRST press and
 * kept for the life of the element — a library of twenty rows costs twenty
 * nothings until somebody presses play, which is what keeps the page and its
 * buttons responsive. `preload="none"` for the same reason.
 */
export function AudioAssetPlayer({ assetId, durationMs, className, onPlay }: { assetId: string; durationMs?: number | null; className?: string; onPlay?: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setUrl(null);
    setPlaying(false);
    setPosition(0);
  }, [assetId]);

  const toggle = useCallback(async () => {
    haptic("selection");
    const el = audio.current;
    if (el && url) {
      if (el.paused) {
        await el.play().catch(() => setError("That audio could not be played."));
      } else el.pause();
      return;
    }
    setLoading(true);
    const res = await getAudioAssetUrl(assetId);
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setUrl(res.url);
    onPlay?.();
  }, [assetId, url, onPlay]);

  useEffect(() => {
    if (!url) return;
    const el = audio.current;
    if (el) void el.play().catch(() => setError("That audio could not be played."));
  }, [url]);

  const total = durationMs && durationMs > 0 ? durationMs / 1000 : (audio.current?.duration ?? 0);
  const progress = total > 0 ? Math.min(100, (position / total) * 100) : 0;

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <button
        type="button"
        onClick={() => void toggle()}
        aria-label={playing ? "Pause" : "Play"}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-foreground text-background transition active:scale-95"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4 translate-x-[1px]" aria-hidden />}
      </button>
      <div className="min-w-0 flex-1">
        {/*
          ── A WAVEFORM, NOT A BAR (owner's reference) ────────────────────

          The reference shows a real waveform behind the progress. This is
          drawn from the ASSET ID, not from decoding the audio: a Web Audio
          decode of every clip would cost a download and a main-thread pass
          per result, and §16 is explicit that decoration must not add
          weight. So the bars are a deterministic hash of the id — the same
          clip always draws the same shape, different clips look different,
          and it costs one loop over 40 numbers.

          ⚠️ IT IS NOT A CLAIM ABOUT THE AUDIO. It is a progress readout with
          texture, marked `role="presentation"`, and the real position is the
          time under it.
        */}
        <div className="flex h-8 items-center gap-[2px]" role="presentation" aria-hidden>
          {waveform(assetId).map((h, i) => {
            const pct = ((i + 1) / 40) * 100;
            return (
              <span
                key={i}
                className={cn("w-full rounded-full transition-colors", pct <= progress ? "bg-primary" : "bg-secondary")}
                style={{ height: `${h}%` }}
              />
            );
          })}
        </div>
        <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
          {fmtTime(position)} {total > 0 ? `/ ${fmtTime(total)}` : null}
          {error ? <span className="ml-2 font-semibold text-rose-600">{error}</span> : null}
        </p>
      </div>
      {/*
        The inline Save is gone. The result screen below carries Download,
        Save to Library and Share as a row of three, per the reference — and
        a fourth affordance inside the player was the same action twice, a
        pixel apart, which §47 (one clear primary action) rules out.
      */}
      {url ? (
        <audio
          ref={audio}
          src={url}
          preload="none"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setPosition(0);
          }}
          onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
          className="hidden"
        />
      ) : null}
    </div>
  );
}

/**
 * 40 bar heights for a clip, derived from its id.
 *
 * Deterministic so the same audio always draws the same shape — a waveform
 * that changed on every render would read as the file being different.
 * Bounded to 22–100% so no bar vanishes and none touches the edge.
 */
function waveform(seed: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out: number[] = [];
  for (let i = 0; i < 40; i++) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    out.push(22 + (Math.abs(h) % 79));
  }
  return out;
}

export function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
