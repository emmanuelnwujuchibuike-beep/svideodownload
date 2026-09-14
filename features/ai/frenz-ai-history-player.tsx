"use client";

import { Download, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { startAiResultDownload } from "@/features/ai/ai-result-download";
import { GlassSheetShell } from "@/features/ui/glass-sheet-shell";
import { getAiJobResult } from "@/lib/ai/client";
import { hoursUntilExpiry, historyResultSentence, historyTitleFor } from "@/lib/ai/history";
import type { AiJobView } from "@/lib/ai/jobs";
import { cn, formatBytes, formatDuration } from "@/lib/utils";

/**
 * The finished video, opened from a history tile.
 *
 * ── 🔴 NO BEFORE/AFTER ANY MORE (2026-09-13) ────────────────────────────────
 *
 * The "Before / after" tab and the five-moment compare roll belonged to AI
 * Clean, whose whole promise was "the same frame with the text gone". That
 * tool is removed (owner: "Just remove the AI Clean features and leave only
 * the new character replace"), and with it the second decode of the source.
 * Character Replace's result is a different performance of the same video, and
 * its own result screen (features/ai/character-replace/) says what changed.
 *
 * One video, its facts, one download. The sheet fetches the signed result URL
 * on open — 10 minutes, ownership checked server-side — and shows the retention
 * sentence, because a member opening this three days later deserves to know
 * how long they have.
 */
export function FrenzAIHistoryPlayer({
  job,
  now,
  onClose,
}: {
  job: AiJobView;
  now: number;
  onClose: () => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  const jobId = job.id;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setPreviewUrl(null);
    void (async () => {
      const res = await getAiJobResult(jobId);
      if (!alive) return;
      setPreviewUrl(res.ok ? res.url : null);
      setLoading(false);
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

  const hours = hoursUntilExpiry(job, now);

  return (
    <GlassSheetShell
      open
      onClose={onClose}
      fitContent
      defaultHeightVh={82}
      title={<span className="min-w-0 truncate">{job.source.name ?? historyTitleFor(job.feature)}</span>}
    >
      <div className="px-4 pb-6">
        {loading ? (
          <div className="flex h-48 items-center justify-center rounded-2xl bg-black/90 text-white/60">
            <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden />
            <span className="sr-only">Loading your video</span>
          </div>
        ) : previewUrl ? (
          <div className="overflow-hidden rounded-2xl bg-black/90">
            <video
              src={previewUrl}
              controls
              playsInline
              preload="metadata"
              className="mx-auto block max-h-[44vh] w-full object-contain"
            />
          </div>
        ) : (
          <div className="flex h-48 items-center justify-center rounded-2xl bg-black/90 px-6 text-center text-sm text-white/70">
            This video is no longer available. Finished videos are kept for a limited time.
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
          One sentence about what this video is, chosen by the tool that made
          it — an old AI Clean row still says what happened to it — followed
          by how long it stays available.
        */}
        <p className="mt-2.5 text-center text-xs leading-relaxed text-muted-foreground">
          {historyResultSentence(job)}
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
