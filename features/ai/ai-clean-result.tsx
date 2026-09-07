"use client";

import { CheckCircle2, Download, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import type { AiJobView } from "@/lib/ai/jobs";
import { cleanedFileName } from "@/lib/ai/clean-media";
import { formatBytes, formatDuration } from "@/lib/utils";

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
 * ── What the member is told about their audio ────────────────────────────────
 *
 * The model returns video with no sound, and Part 4's worker muxes the original
 * back on. `audioRestored` records what actually happened, and there are three
 * different truths to tell — sound is back, the source never had any, or we do
 * not know because the row predates this. They are said differently, because
 * "no audio" and "we could not restore your audio" are not the same sentence
 * and a member can tell.
 */
export function AICleanResult({
  job,
  fetchResultUrl,
  onStartAnother,
}: {
  job: AiJobView;
  fetchResultUrl: () => Promise<string | null>;
  onStartAnother: () => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

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
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-5 w-5 text-emerald-500" aria-hidden />
        <h2 className="text-lg font-bold tracking-[-0.01em]">Your video is ready</h2>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl bg-black/90">
        {loading ? (
          <div className="flex h-48 items-center justify-center text-white/60">
            <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden />
            <span className="sr-only">Loading your video</span>
          </div>
        ) : previewUrl ? (
          <video
            src={previewUrl}
            controls
            playsInline
            preload="metadata"
            className="mx-auto block max-h-[46vh] w-full object-contain"
          />
        ) : (
          <div className="flex h-48 items-center justify-center px-6 text-center text-sm text-white/70">
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
