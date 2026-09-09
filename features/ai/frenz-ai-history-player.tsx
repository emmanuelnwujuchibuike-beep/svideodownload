"use client";

import { Download, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { startAiResultDownload } from "@/features/ai/ai-result-download";
import { FrenzAICompareRoll } from "@/features/ai/core/frenz-ai-compare-roll";
import { GlassSheetShell } from "@/features/ui/glass-sheet-shell";
import { getAiJobResult, getAiJobSource } from "@/lib/ai/client";
import { hoursUntilExpiry } from "@/lib/ai/history";
import type { AiJobView } from "@/lib/ai/jobs";
import { cn, formatBytes, formatDuration } from "@/lib/utils";

/**
 * A finished video, reopened from history.
 *
 * ── 🔴 WHY THIS IS NOT `AICleanResult` ──────────────────────────────────────
 *
 * That component is a SCREEN: it owns the page's breadcrumb, its headline
 * ("Your video is ready."), the reveal animation that says work has just
 * finished, the retention line and "Clean another video". Every one of those is
 * wrong for a video made last Tuesday and opened from a list — a materialise
 * animation on a week-old file is a claim that something just happened.
 *
 * What the two genuinely share is the SAVE, and that is shared for real:
 * `startAiResultDownload` is one implementation used by both. The rest is
 * different on purpose, not by accident.
 *
 * ── The link is fetched here and never stored ───────────────────────────────
 *
 * The result lives in a private bucket and its signed url lasts minutes, so it
 * is requested when this sheet opens. Download does NOT reuse it: it goes
 * through our own route, which re-signs per request (see ai-result-download.ts).
 */
export function FrenzAIHistoryPlayer({
  job,
  now,
  onClose,
}: {
  job: AiJobView;
  /** The section's shared clock, so the sheet and the row cannot disagree. */
  now: number;
  onClose: () => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [view, setView] = useState<"result" | "compare">("result");

  const jobId = job.id;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setPreviewUrl(null);
    setSourceUrl(null);
    setView("result");

    void (async () => {
      const res = await getAiJobResult(jobId);
      if (!alive) return;
      setPreviewUrl(res.ok ? res.url : null);
      setLoading(false);
    })();

    /*
      The original, fetched quietly and separately. It is only wanted for the
      comparison, so its failure must never delay or disturb the video itself —
      the toggle simply does not appear. A source is often the first thing a
      retention job would remove, so "no before/after" is an ordinary outcome
      here rather than an error worth a sentence.
    */
    void (async () => {
      const res = await getAiJobSource(jobId);
      if (alive && res.ok) setSourceUrl(res.url);
    })();

    return () => {
      alive = false;
    };
  }, [jobId]);

  const download = useCallback(() => {
    setDownloading(true);
    startAiResultDownload(job);
    // The download manager owns everything after this — progress, the
    // completion card, the save, the history row.
    setTimeout(() => setDownloading(false), 900);
  }, [job]);

  const canCompare = !!previewUrl && !!sourceUrl;
  const hours = hoursUntilExpiry(job, now);

  return (
    <GlassSheetShell
      open
      onClose={onClose}
      fitContent
      defaultHeightVh={82}
      title={
        <span className="min-w-0 truncate">{job.source.name ?? "Cleaned video"}</span>
      }
    >
      <div className="px-4 pb-6">
        {canCompare ? (
          <div className="mx-auto mb-3 flex w-fit rounded-full bg-secondary p-1">
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

        {loading ? (
          <div className="flex h-48 items-center justify-center rounded-2xl bg-black/90 text-white/60">
            <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden />
            <span className="sr-only">Loading your video</span>
          </div>
        ) : previewUrl ? (
          <>
            <div className={view === "result" ? undefined : "hidden"}>
              <div className="overflow-hidden rounded-2xl bg-black/90">
                <video
                  src={previewUrl}
                  controls
                  playsInline
                  preload="metadata"
                  className="mx-auto block max-h-[44vh] w-full object-contain"
                />
              </div>
            </div>
            {/*
              Mounted alongside rather than swapped in, so switching tabs does
              not re-run the frame capture. Hidden with a class, not unmounted:
              the two decodes happen once for the life of this sheet.
            */}
            {canCompare && sourceUrl ? (
              <div className={view === "compare" ? undefined : "hidden"}>
                {/*
                  ── 🔴 THE ROLL, NOT THE SINGLE FRAME (owner, 2026-09-09) ────

                  "have a full understandable before and after roll."

                  The result screen keeps `FrenzAICompare`, which samples one
                  moment — on the screen where a video has just been made, one
                  frame and one drag is the proof somebody wants.

                  History is the opposite question. It is opened days later,
                  about a video whose text may have been removed in one place
                  and missed in another — which is not hypothetical: the same
                  week, a clip's overlay caption came out cleanly while a
                  burned-in subtitle eleven seconds later was never detected.
                  A comparison pinned to one timestamp would have reported
                  either "perfect" or "nothing happened" depending on which of
                  those it landed on. Five moments report what actually
                  happened.
                */}
                <FrenzAICompareRoll beforeUrl={sourceUrl} afterUrl={previewUrl} />
              </div>
            ) : null}
          </>
        ) : (
          <div className="flex h-48 items-center justify-center rounded-2xl bg-black/90 px-6 text-center text-sm text-white/70">
            This video is no longer available. Cleaned videos are kept for three days.
          </div>
        )}

        <dl className="mt-3.5 grid grid-cols-3 gap-2 rounded-2xl border border-border/60 bg-card/95 p-3">
          <Fact label="Size" value={job.source.size ? formatBytes(job.source.size) : null} />
          <Fact
            label="Length"
            value={job.source.durationSeconds ? formatDuration(job.source.durationSeconds) : null}
          />
          <Fact
            label="Took"
            value={job.durationMs ? formatDuration(Math.round(job.durationMs / 1000)) : null}
          />
        </dl>

        {/*
          The audio sentence, said once. Three different truths — the sound is
          back, the source never had any, or this row predates the column — and
          they are not interchangeable: "no audio" and "we could not restore
          your audio" are different claims and a member can tell.
        */}
        <p className="mt-2.5 text-center text-xs leading-relaxed text-muted-foreground">
          {job.result.audioRestored === true
            ? "Text removed, original audio back on it."
            : job.result.audioRestored === false
              ? "Text removed. This video had no sound to restore."
              : "Text removed."}
          {hours !== null
            ? hours >= 24
              ? ` Available for ${Math.floor(hours / 24)} more ${Math.floor(hours / 24) === 1 ? "day" : "days"}.`
              : ` Available for ${hours} more ${hours === 1 ? "hour" : "hours"}.`
            : ""}
        </p>

        <button
          type="button"
          onClick={download}
          disabled={downloading || !previewUrl}
          className={cn(
            "mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-3.5",
            "bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500",
            "text-sm font-bold text-white shadow-[0_14px_34px_-12px_rgb(99_102_241/0.95)]",
            "transition duration-200 motion-safe:hover:-translate-y-0.5 active:scale-[0.99]",
            "disabled:opacity-60 disabled:hover:translate-y-0",
          )}
        >
          <Download className="h-4 w-4" aria-hidden />
          {downloading ? "Preparing…" : "Download video"}
        </button>
      </div>
    </GlassSheetShell>
  );
}

/** `null` renders as an em-dash. Not measured is not zero. */
function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0 text-center">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-bold tabular-nums">
        {value ?? <span className="font-medium text-muted-foreground">&mdash;</span>}
      </dd>
    </div>
  );
}
