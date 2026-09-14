"use client";

import { ArrowLeft, Check, Download, History, Maximize2, Share2, Smartphone, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { aiResultDownloadHref, startAiResultDownload } from "@/features/ai/ai-result-download";
import { VideoReadyPlayer, type VideoReadyPlayerHandle } from "@/features/ai/character-replace/video-ready-player";
import type { CharacterReplacePublicConfig } from "@/lib/ai/character-replace/config";
import type { CharacterReplaceResult } from "@/lib/ai/character-replace/types";
import { formatSeconds } from "@/lib/ai/character-replace/workspace";
import { resultFileName, resultSuffixFor } from "@/lib/ai/media";
import { isIosDevice } from "@/lib/client-download";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  VIDEO READY — a premium viewer, the clean master, and the phone's own editor
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-14 (the Video Ready brief): "The completed page should feel
 * like a premium media viewer rather than a generic result page… the VIDEO
 * should remain the hero… Download Video is the primary action… Native
 * device editing should be the optional final step."
 *
 * Top to bottom: a minimal header (Back · Video Ready · a ready mark), one
 * sentence, the viewer (features/ai/character-replace/video-ready-player.tsx),
 * Download Video, then Fullscreen and Share as the two quiet secondaries,
 * then "Edit on your phone" — the honest hand-off to Photos / Google Photos —
 * and the facts.
 *
 * ── The master is the model's output ────────────────────────────────────────
 * What plays here is the stored file over a short signed URL; what downloads
 * is the same bytes through the same-origin result route (no transform, no
 * re-encode — see the finalizer's colour audit). No CSS filter touches the
 * frame. There are no Frenz AI colour/filter tools to hide or reorganise:
 * none exist for this product, and none are invented here.
 *
 * ── What each platform can honestly do ──────────────────────────────────────
 *   · iOS: Download hands the file to the share sheet (the download manager
 *     already does this — `saveToDevice`), where "Save Video" puts it in
 *     Photos. Photos → Edit is Apple's editor; nothing here pretends to open
 *     it directly, because no web API can.
 *   · Android: Download saves to the device; the gallery / Google Photos
 *     picks it up. Share (Web Share with a file, feature-detected) lists
 *     Google Photos and the rest as targets. Google Photos → Edit is theirs.
 *   · Desktop: Download saves the master; Share hides where absent.
 *
 * ── Memory ──────────────────────────────────────────────────────────────────
 * The viewer streams; nothing is fetched into memory until Download or
 * Share is pressed, and Share releases its blob as soon as the sheet closes.
 */
export function CharacterReplaceResultScreen({
  result,
  config,
  historyHref,
  onMakeAnother,
  onBack,
  className,
}: {
  result: CharacterReplaceResult;
  config: CharacterReplacePublicConfig | null;
  historyHref: string;
  onMakeAnother: () => void;
  /** The header's Back. Defaults to "make another" (the workspace, fresh). */
  onBack?: () => void;
  className?: string;
}) {
  const player = useRef<VideoReadyPlayerHandle | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [platform, setPlatform] = useState<"ios" | "android" | "other">("other");
  const [canShareFiles, setCanShareFiles] = useState(false);

  // Read in an effect: the server markup has no platform, and a mismatch is a hydration error.
  useEffect(() => {
    setPlatform(isIosDevice() ? "ios" : /android/i.test(navigator.userAgent) ? "android" : "other");
    setCanShareFiles(typeof navigator.share === "function" && typeof navigator.canShare === "function");
  }, []);

  const download = useCallback(() => {
    setDownloading(true);
    startAiResultDownload(result.job);
    setTimeout(() => setDownloading(false), 900);
  }, [result.job]);

  /*
    Share the FILE where the platform accepts one (Android Chrome lists Google
    Photos; iOS lists Save Video) — fetched only now, through the same-origin
    route, and released when the sheet closes. Where files cannot be shared
    the button is not drawn at all: a share sheet with nothing but a private
    URL in it is not a feature.
  */
  const share = useCallback(async () => {
    if (sharing) return;
    haptic("light");
    setSharing(true);
    try {
      const res = await fetch(aiResultDownloadHref(result.job.id), { credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], resultFileName(result.job.source.name, resultSuffixFor(result.job.feature)), { type: blob.type || "video/mp4" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "My Character Replace video" });
      } else {
        // The platform accepts a share but not a file — the download is the honest equivalent.
        startAiResultDownload(result.job);
      }
    } catch (e) {
      if (!(e instanceof Error && e.name === "AbortError")) startAiResultDownload(result.job);
    } finally {
      setSharing(false);
    }
  }, [result.job, sharing]);

  const quality = config?.qualities.find((q) => q.id === result.quality)?.label ?? result.quality ?? "—";
  const language = config?.languages.find((l) => l.code === result.voice?.languageCode)?.label;
  const voice = config?.voices.find((v) => v.id === result.voice?.voiceId)?.label;
  const voiceLine = result.voice?.mode === "new_voice" ? [language, voice].filter(Boolean).join(" · ") || "New voice" : "Original audio";
  const poster = result.job.result.hasPoster ? `/api/ai/jobs/${encodeURIComponent(result.job.id)}/poster` : null;
  const attempt = result.job.characterReplace?.attempt ?? 1;

  return (
    <section className={cn("space-y-4", className)} aria-labelledby="video-ready-title">
      {/* header — minimal */}
      <header className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack ?? onMakeAnother}
          aria-label="Back"
          className="flex h-10 w-10 items-center justify-center rounded-full text-foreground transition hover:bg-secondary active:scale-95"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <h2 id="video-ready-title" className="text-[19px] font-bold leading-tight tracking-[-0.02em]">
            Video Ready
          </h2>
          <p className="text-[12.5px] text-muted-foreground">Your video has been successfully generated.</p>
        </div>
        <span
          role="status"
          aria-live="polite"
          className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-emerald-600"
        >
          <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
          Ready
        </span>
      </header>

      {/* the hero */}
      <VideoReadyPlayer ref={player} src={result.previewUrl} poster={poster} title="Your Character Replace video" />

      {/* the one primary action, then two quiet ones */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={download}
          disabled={downloading || !result.previewUrl}
          className={cn(
            "flex min-h-[54px] w-full items-center justify-center gap-2.5 rounded-[1.1rem] bg-foreground px-6",
            "text-[15.5px] font-semibold tracking-[-0.01em] text-background",
            "shadow-[0_12px_28px_-16px_rgba(15,23,42,0.55)] transition motion-safe:hover:-translate-y-0.5 active:scale-[0.99]",
            "disabled:opacity-60 disabled:hover:translate-y-0",
          )}
        >
          <Download className="h-[18px] w-[18px]" aria-hidden />
          {downloading ? "Preparing…" : "Download Video"}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => player.current?.enterFullscreen()}
            disabled={!result.previewUrl}
            className="btn-lux min-h-[46px] border border-border/70 bg-card text-[13.5px] text-foreground hover:border-foreground/25 disabled:opacity-50"
          >
            <Maximize2 className="h-4 w-4" aria-hidden />
            Fullscreen
          </button>
          {canShareFiles ? (
            <button
              type="button"
              onClick={() => void share()}
              disabled={sharing || !result.previewUrl}
              className="btn-lux min-h-[46px] border border-border/70 bg-card text-[13.5px] text-foreground hover:border-foreground/25 disabled:opacity-50"
            >
              <Share2 className="h-4 w-4" aria-hidden />
              {sharing ? "Preparing…" : "Share"}
            </button>
          ) : (
            <button
              type="button"
              onClick={onMakeAnother}
              className="btn-lux min-h-[46px] border border-border/70 bg-card text-[13.5px] text-foreground hover:border-foreground/25"
            >
              <Sparkles className="h-4 w-4" aria-hidden />
              Create Another
            </button>
          )}
        </div>
      </div>

      {/* the honest hand-off to the phone's own editor */}
      <aside className="flex gap-3 rounded-[1.25rem] bg-secondary/50 px-4 py-3.5" aria-label="Edit on your phone">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-card text-primary ring-1 ring-inset ring-black/[0.05] dark:ring-white/10">
          <Smartphone className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-[13.5px] font-bold tracking-[-0.01em]">Edit on your phone</p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{editingLine(platform)}</p>
        </div>
      </aside>

      {/* the facts */}
      <dl className="grid grid-cols-3 gap-2 text-center">
        <Fact label="Duration" value={formatSeconds(result.durationSeconds)} />
        <Fact label="Quality" value={quality} />
        <Fact label="Created" value={createdOn(result.job.createdAt)} />
      </dl>
      <p className="text-center text-[11.5px] text-muted-foreground">
        {voiceLine}
        {attempt > 1 ? ` · attempt ${attempt}` : ""}
        {" · "}
        Saved to{" "}
        <Link href={historyHref} prefetch={false} className="font-semibold text-foreground underline-offset-4 hover:underline">
          Your AI videos
        </Link>{" "}
        for three days.
      </p>

      {canShareFiles ? (
        <button
          type="button"
          onClick={onMakeAnother}
          className="btn-lux mx-auto flex border border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <Sparkles className="h-4 w-4" aria-hidden />
          Create Another
        </button>
      ) : (
        <p className="flex items-center justify-center gap-1.5 text-center text-[12px] text-muted-foreground">
          <History className="h-3.5 w-3.5" aria-hidden />
          Every video you make is kept privately for three days.
        </p>
      )}
    </section>
  );
}

function editingLine(platform: "ios" | "android" | "other"): string {
  switch (platform) {
    case "ios":
      return "Download, then choose Save Video in the share sheet. In Photos, open the video and tap Edit for Apple's own colour, crop and adjustment tools.";
    case "android":
      return "Download saves the clean master to your gallery. Open it in Google Photos (or your gallery app) and tap Edit for filters and adjustments.";
    default:
      return "Download the clean master and open it in any editor you like — the file is a standard MP4 at the resolution you chose.";
  }
}

function createdOn(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "Today";
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-card px-2 py-2.5 ring-1 ring-inset ring-black/[0.05] dark:ring-white/10">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">{label}</dt>
      <dd className="mt-0.5 truncate text-[13px] font-semibold tabular-nums" title={value}>
        {value}
      </dd>
    </div>
  );
}
