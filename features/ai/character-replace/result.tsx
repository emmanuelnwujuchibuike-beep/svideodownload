"use client";

import { Download, History, Loader2, Share2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

import { startAiResultDownload } from "@/features/ai/ai-result-download";
import type { CharacterReplacePublicConfig } from "@/lib/ai/character-replace/config";
import type { CharacterReplaceResult } from "@/lib/ai/character-replace/types";
import { formatSeconds } from "@/lib/ai/character-replace/workspace";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE RESULT — §14, as one screen
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Driven by a `CharacterReplaceResult`: the finished job, a signed preview
 * URL, and the settings it was made with. The player is native (controls,
 * never autoplay, `playsInline`); the facts are the four the owner named;
 * the actions are download, share and the way to history.
 *
 * ── Download goes through the platform's download manager ───────────────────
 *
 * `startAiResultDownload` is what every AI result already uses: the manager
 * owns the progress card, the sound, the save and the history row. A second
 * download path here would be a second thing to keep honest.
 *
 * ── Share uses the browser's own sheet, when there is one ───────────────────
 *
 * The product's composers and the download player all share with
 * `navigator.share` and nothing else — no third-party sheet — so this does
 * the same, and hides the button where the API is absent (a desktop browser
 * without it gets Download, which is the honest equivalent).
 *
 * ── "Save to history" is already true ───────────────────────────────────────
 *
 * Every job is a row in `ai_jobs` from the moment it is created, and history
 * lists them all. So the screen SAYS the video is saved and links there,
 * rather than offering a button for something that has already happened.
 */
export function CharacterReplaceResultScreen({
  result,
  config,
  historyHref,
  onMakeAnother,
  className,
}: {
  result: CharacterReplaceResult;
  config: CharacterReplacePublicConfig | null;
  historyHref: string;
  onMakeAnother: () => void;
  className?: string;
}) {
  const [downloading, setDownloading] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const download = useCallback(() => {
    setDownloading(true);
    startAiResultDownload(result.job);
    setTimeout(() => setDownloading(false), 900);
  }, [result.job]);

  const share = useCallback(async () => {
    haptic("light");
    try {
      await navigator.share({ title: "My Character Replace video on Frenz", url: window.location.href });
    } catch {
      /* the member closed the sheet; nothing to report */
    }
  }, []);

  const quality = config?.qualities.find((q) => q.id === result.quality)?.label ?? result.quality ?? "—";
  const language = config?.languages.find((l) => l.code === result.voice?.languageCode)?.label;
  const voice = config?.voices.find((v) => v.id === result.voice?.voiceId)?.label;
  const voiceLine = result.voice?.mode === "new_voice" ? [language, voice].filter(Boolean).join(" · ") || "New voice" : "Original audio";
  const lipLine = result.lipSync?.tier ? (config?.lipSync.find((l) => l.id === result.lipSync?.tier)?.label ?? result.lipSync.tier) : "Not used";

  return (
    <section className={cn("space-y-4", className)}>
      <div className="overflow-hidden rounded-[1.5rem] border border-border/70 bg-card">
        <div className="bg-[#0b0f1a]">
          {result.previewUrl ? (
            <video src={result.previewUrl} controls playsInline preload="metadata" className="mx-auto block max-h-[min(62vh,30rem)] w-full object-contain" />
          ) : (
            <div className="flex h-56 items-center justify-center text-white/60">
              <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden />
              <span className="sr-only">Loading your video</span>
            </div>
          )}
        </div>
        <dl className="grid grid-cols-2 divide-x divide-y divide-border/60 border-t border-border/60 sm:grid-cols-4 sm:divide-y-0">
          <Fact label="Duration" value={formatSeconds(result.durationSeconds)} />
          <Fact label="Quality" value={quality} />
          <Fact label="Voice" value={voiceLine} />
          <Fact label="Lip sync" value={lipLine} />
        </dl>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={download}
          disabled={downloading || !result.previewUrl}
          className={cn(
            "inline-flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-full px-6",
            "bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500 text-[14px] font-bold text-white",
            "shadow-[0_14px_34px_-14px_rgb(99_102_241/0.9)] transition motion-safe:hover:-translate-y-0.5 active:scale-[0.99]",
            "disabled:opacity-60 disabled:hover:translate-y-0",
          )}
        >
          <Download className="h-4 w-4" aria-hidden />
          {downloading ? "Preparing…" : "Download video"}
        </button>
        {canShare ? (
          <button
            type="button"
            onClick={() => void share()}
            className="btn-lux min-h-[52px] border border-border/70 bg-card text-foreground hover:border-foreground/25"
          >
            <Share2 className="h-4 w-4" aria-hidden />
            Share
          </button>
        ) : null}
      </div>

      <p className="flex items-center justify-center gap-1.5 text-center text-[12.5px] text-muted-foreground">
        <History className="h-3.5 w-3.5" aria-hidden />
        Saved to{" "}
        <Link href={historyHref} prefetch={false} className="font-semibold text-foreground underline-offset-4 hover:underline">
          Your AI videos
        </Link>{" "}
        for three days.
      </p>

      <button
        type="button"
        onClick={onMakeAnother}
        className="btn-lux mx-auto flex border border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <Sparkles className="h-4 w-4" aria-hidden />
        Make another
      </button>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-3 py-2.5 text-center">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">{label}</dt>
      <dd className="mt-0.5 truncate text-[13px] font-semibold tabular-nums" title={value}>
        {value}
      </dd>
    </div>
  );
}
