"use client";

import { Download, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import { FrenzAICompare } from "@/features/ai/core/frenz-ai-compare";
import { FrenzAICore } from "@/features/ai/core/frenz-ai-core";
import { FrenzAIReveal } from "@/features/ai/core/frenz-ai-reveal";
import type { AiJobView } from "@/lib/ai/jobs";
import { cleanedFileName } from "@/lib/ai/clean-media";
import { cn, formatBytes, formatDuration } from "@/lib/utils";

/**
 * The finished video.
 *
 * ── 🔴 THE LINK IS FETCHED, NOT STORED ───────────────────────────────────────
 *
 * The result lives in a private bucket with no read policy, so playing it needs
 * a signed URL — and that URL expires in minutes. It is therefore requested
 * when this panel mounts and requested AGAIN when the member presses Download,
 * because a link that was valid when the page loaded is very often dead by the
 * time somebody has watched the video and decided to keep it. Holding one in
 * state for the length of a session would produce exactly that failure, and it
 * would look like the file was gone.
 *
 * ── The reveal, and the proof (2026-09-07) ───────────────────────────────────
 *
 * A result does not appear — it materialises, then its controls follow a beat
 * later (FrenzAIReveal). One 620ms animation, once, so the finished video reads
 * as something that was made rather than something that loaded.
 *
 * And it can be checked. "Before" puts the original beside the result on a
 * dragging divider, which for a text-removal tool is the difference between
 * claiming it worked and showing it. That comparison decodes ONE frame from each
 * file and then releases both video elements — see FrenzAICompare for why two
 * playing videos was the wrong build.
 *
 * ── What the member is told about their audio ────────────────────────────────
 *
 * The model returns video with no sound, and Part 4's worker muxes the original
 * back on. `audioRestored` records what actually happened, and there are three
 * different truths to tell — sound is back, the source never had any, or we do
 * not know because the row predates this. They are said differently, because
 * "no audio" and "we could not restore your audio" are not the same sentence
 * and a member can tell.
 */
type View = "result" | "compare";

export function AICleanResult({
  job,
  fetchResultUrl,
  fetchSourceUrl,
  onStartAnother,
}: {
  job: AiJobView;
  fetchResultUrl: () => Promise<string | null>;
  /** Optional: without it, the comparison is simply not offered. */
  fetchSourceUrl?: () => Promise<string | null>;
  onStartAnother: () => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [view, setView] = useState<View>("result");

  useEffect(() => {
    let alive = true;
    (async () => {
      const url = await fetchResultUrl();
      if (!alive) return;
      setPreviewUrl(url);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [fetchResultUrl]);

  /*
    The original, fetched separately and quietly. It is only needed for the
    comparison, so its failure must never delay or disturb the result itself —
    the toggle simply does not appear.
  */
  useEffect(() => {
    if (!fetchSourceUrl) return;
    let alive = true;
    (async () => {
      const url = await fetchSourceUrl();
      if (alive) setSourceUrl(url);
    })();
    return () => {
      alive = false;
    };
  }, [fetchSourceUrl]);

  const canCompare = !!previewUrl && !!sourceUrl;

  const download = async () => {
    setDownloading(true);
    // A fresh link, every time. See the note above.
    const url = await fetchResultUrl();
    setDownloading(false);
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = cleanedFileName(job.source.name);
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-col items-center text-center">
        {/* Settled: the environment comes back down after the work. */}
        <FrenzAICore presence="settled" size="lg" />
        <h2 className="mt-3 text-lg font-bold tracking-[-0.01em]">Your video is ready</h2>
      </div>

      {canCompare ? (
        <div className="mx-auto mt-4 flex w-fit rounded-full bg-secondary p-1">
          {(["result", "compare"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setView(tab)}
              aria-pressed={view === tab}
              className={cn(
                "rounded-full px-4 py-1.5 text-xs font-semibold transition",
                view === tab ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab === "result" ? "Result" : "Before / after"}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-4">
        {loading ? (
          <div className="flex h-48 items-center justify-center rounded-2xl bg-black/90 text-white/60">
            <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden />
            <span className="sr-only">Loading your video</span>
          </div>
        ) : previewUrl ? (
          <FrenzAIReveal>
            <div className={view === "result" ? undefined : "hidden"}>
              <div className="overflow-hidden rounded-2xl bg-black/90">
                <video
                  src={previewUrl}
                  controls
                  playsInline
                  preload="metadata"
                  className="mx-auto block max-h-[46vh] w-full object-contain"
                />
              </div>
            </div>
            {/*
              Mounted alongside rather than swapped in, so switching tabs does
              not re-run the frame capture. Hidden with a class, not unmounted:
              the two decodes happen once for the life of this panel.
            */}
            {canCompare && sourceUrl ? (
              <div className={view === "compare" ? undefined : "hidden"}>
                <FrenzAICompare beforeUrl={sourceUrl} afterUrl={previewUrl} />
              </div>
            ) : null}
          </FrenzAIReveal>
        ) : (
          <div className="flex h-48 items-center justify-center rounded-2xl bg-black/90 px-6 text-center text-sm text-white/70">
            That link has expired. Press Download and we&apos;ll make a fresh one.
          </div>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Fact label="Size" value={job.source.size ? formatBytes(job.source.size) : null} />
        <Fact
          label="Length"
          value={job.source.durationSeconds ? formatDuration(job.source.durationSeconds) : null}
        />
        <Fact label="Took" value={job.durationMs ? formatDuration(Math.round(job.durationMs / 1000)) : null} />
      </dl>

      <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse sm:items-center">
        <button type="button" onClick={download} disabled={downloading} className="btn-lux btn-lux-primary w-full sm:w-auto">
          <Download className="h-4 w-4" aria-hidden />
          {downloading ? "Preparing…" : "Download"}
        </button>
        <button type="button" onClick={onStartAnother} className="btn-lux btn-lux-secondary">
          <RotateCcw className="h-4 w-4" aria-hidden />
          Clean another video
        </button>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        {job.result.audioRestored === true
          ? "Cleaned, with your original audio back on it."
          : job.result.audioRestored === false
            ? // Not an apology: this video never had sound to restore, and
              // saying so is the difference between a fact and a fault.
              "Cleaned. This video had no sound to restore."
            : "Cleaned and ready."}{" "}
        Your video is kept privately for three days.
      </p>
    </div>
  );
}

/** `null` renders as an em-dash. Not measured is not zero. */
function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium tabular-nums">
        {value ?? <span className="text-muted-foreground">&mdash;</span>}
      </dd>
    </div>
  );
}
