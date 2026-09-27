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
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary" role="presentation">
          <div className="h-full rounded-full bg-primary transition-[width] duration-150" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
          {fmtTime(position)} {total > 0 ? `/ ${fmtTime(total)}` : null}
          {error ? <span className="ml-2 font-semibold text-rose-600">{error}</span> : null}
        </p>
      </div>
      <a
        href={audioDownloadHref(assetId)}
        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-border px-3 text-[12px] font-semibold"
        aria-label="Download this audio"
      >
        <Download className="h-3.5 w-3.5" aria-hidden /> Save
      </a>
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

export function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
