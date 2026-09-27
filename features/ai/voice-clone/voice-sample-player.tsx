"use client";

import { Loader2, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { getVoiceSampleUrl } from "@/lib/ai/voice-clone/client";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * The member's own recording, played back in place.
 *
 * The URL is signed and short-lived, so it is fetched on the FIRST press and
 * kept for the life of the element — a library of ten voices costs ten nothings
 * until somebody presses play. `preload="none"` for the same reason.
 *
 * 🔴 This plays the SAMPLE, not a generated preview. Generating one would be a
 * text-to-speech charge on a page where nobody asked for audio; the sample is
 * already theirs and already here.
 */
export function VoiceSamplePlayer({ cloneId, className }: { cloneId: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setUrl(null);
    setPlaying(false);
  }, [cloneId]);

  const toggle = useCallback(async () => {
    haptic("selection");
    const el = audio.current;
    if (el && url) {
      if (el.paused) await el.play().catch(() => setError("That recording could not be played."));
      else el.pause();
      return;
    }
    setLoading(true);
    const res = await getVoiceSampleUrl(cloneId);
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setUrl(res.url);
  }, [cloneId, url]);

  useEffect(() => {
    if (!url) return;
    const el = audio.current;
    if (el) void el.play().catch(() => setError("That recording could not be played."));
  }, [url]);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <button
        type="button"
        onClick={() => void toggle()}
        aria-label={playing ? "Pause your recording" : "Play your recording"}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card transition active:scale-95"
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : playing ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5 translate-x-[1px]" aria-hidden />}
      </button>
      <span className="text-[11px] text-muted-foreground">{error ? <span className="font-semibold text-rose-600">{error}</span> : "Your recording"}</span>
      {url ? <audio ref={audio} src={url} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} className="hidden" /> : null}
    </div>
  );
}
