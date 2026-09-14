"use client";

import { AlertTriangle, BellRing, Check, RotateCcw, XCircle } from "lucide-react";

import { FrenzAICore } from "@/features/ai/core/frenz-ai-core";
import { PROCESSING_STAGES, isProcessingActive, type ProcessingJob } from "@/lib/ai/character-replace/types";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PROCESSING — §13's states, as one screen
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Driven entirely by a `ProcessingJob`. The real job system plugs into this
 * by producing that object; nothing here knows how a job is started.
 *
 * ── 🔴 THE BAR IS HONEST ─────────────────────────────────────────────────────
 *
 * `progress` is drawn as a width only when it is a MEASUREMENT (bytes sent
 * during the upload). Every other active phase gets the product's own
 * indeterminate stripe — never a number that creeps. This codebase learned
 * the cost of a creeping bar the hard way: a job that had never started sat
 * at "58%" for as long as anybody watched, and the number hid that nothing
 * was happening. An ETA is printed only when the server gave one.
 *
 * The tracker lists the stages in order; the current one is lit, earlier ones
 * ticked, later ones dimmed. Terminal states replace the tracker with a
 * sentence and one action.
 */
export function CharacterReplaceProcessing({
  job,
  onCancel,
  onRetry,
  onDone,
  className,
}: {
  job: ProcessingJob;
  /** Present only where cancelling is technically safe (no charge left behind). */
  onCancel?: () => void;
  onRetry?: () => void;
  /** Complete: continue to the result. */
  onDone?: () => void;
  className?: string;
}) {
  const active = isProcessingActive(job.status);
  const stage = PROCESSING_STAGES.find((s) => s.key === job.status);
  const currentIndex = PROCESSING_STAGES.findIndex((s) => s.key === job.status);

  if (job.status === "failed" || job.status === "refunded" || job.status === "cancelled") {
    const refunded = job.status === "refunded";
    const cancelled = job.status === "cancelled";
    return (
      <section aria-live="polite" className={cn("rounded-[1.5rem] border border-border/70 bg-card px-5 py-6 text-center", className)}>
        <span
          className={cn(
            "mx-auto flex h-12 w-12 items-center justify-center rounded-2xl",
            cancelled ? "bg-secondary text-muted-foreground" : "bg-rose-500/10 text-rose-500",
          )}
        >
          {cancelled ? <XCircle className="h-6 w-6" aria-hidden /> : <AlertTriangle className="h-6 w-6" aria-hidden />}
        </span>
        <h2 className="mt-4 text-[19px] font-bold tracking-[-0.02em]">
          {cancelled ? "Cancelled" : refunded ? "We couldn't complete this video — refunded" : "We couldn't complete this video"}
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed text-muted-foreground">
          {job.message ??
            (cancelled
              ? "Nothing was charged."
              : refunded
                ? "The charge has been returned to your balance. You can try again whenever you like."
                : "Something went wrong on our side. Nothing was charged — you can try again.")}
        </p>
        {onRetry ? (
          <button type="button" onClick={onRetry} className="btn-lux mt-5 bg-foreground text-background">
            <RotateCcw className="h-4 w-4" aria-hidden />
            Try again
          </button>
        ) : null}
      </section>
    );
  }

  if (job.status === "complete") {
    return (
      <section aria-live="polite" className={cn("rounded-[1.5rem] border border-border/70 bg-card px-5 py-6 text-center", className)}>
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600">
          <Check className="h-6 w-6" strokeWidth={3} aria-hidden />
        </span>
        <h2 className="mt-4 text-[19px] font-bold tracking-[-0.02em]">Your video is ready</h2>
        {onDone ? (
          <button type="button" onClick={onDone} className="btn-lux mt-5 bg-foreground text-background">
            View result
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <section aria-live="polite" aria-busy={active} className={cn("rounded-[1.5rem] border border-border/70 bg-card", className)}>
      <div className="flex items-center gap-4 px-5 pt-5">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-secondary/70">
          <FrenzAICore size="md" presence="working" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{stage?.label ?? "Working"}</p>
          <h2 className="mt-0.5 text-[19px] font-bold leading-tight tracking-[-0.02em]">{headline(job)}</h2>
          {job.estimatedSecondsRemaining !== null ? (
            <p className="mt-1 text-[12.5px] text-muted-foreground">About {eta(job.estimatedSecondsRemaining)} left</p>
          ) : null}
        </div>
      </div>

      {/* the bar — measured, or indeterminate; never a creeping number */}
      <div className="mx-5 mt-4 h-1.5 overflow-hidden rounded-full bg-secondary" role={job.progress !== null ? "progressbar" : undefined} aria-valuenow={job.progress !== null ? Math.round(job.progress * 100) : undefined} aria-valuemin={0} aria-valuemax={100}>
        {job.progress !== null ? (
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500 transition-[width] duration-300 ease-out motion-reduce:transition-none"
            style={{ width: `${Math.max(2, Math.min(100, job.progress * 100))}%` }}
          />
        ) : (
          <div className="frenz-loader-bar h-full w-2/5 rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500" />
        )}
      </div>

      {/* the tracker */}
      <ol className="mt-4 divide-y divide-border/60 border-t border-border/60">
        {PROCESSING_STAGES.map((s, i) => {
          const done = i < currentIndex;
          const doing = i === currentIndex;
          return (
            <li key={s.key} className="flex items-center gap-3 px-5 py-2.5" aria-current={doing ? "step" : undefined}>
              <span
                aria-hidden
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
                  done && "bg-emerald-500/15 text-emerald-600",
                  doing && "bg-foreground text-background",
                  !done && !doing && "bg-secondary text-muted-foreground/60",
                )}
              >
                {done ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}
              </span>
              <span className={cn("text-[13.5px]", doing ? "font-bold" : done ? "text-muted-foreground" : "text-muted-foreground/60")}>{s.label}</span>
            </li>
          );
        })}
      </ol>

      <div className="border-t border-border/60 px-5 py-4">
        <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-muted-foreground">
          <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-primary/70" aria-hidden />
          Your video is being processed in the background. You can leave FrenzSave and we&apos;ll notify you when it&apos;s
          ready.
        </p>
        {job.canCancel && onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="btn-lux mt-3 border border-border/70 bg-card text-foreground hover:border-foreground/25"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </section>
  );
}

function headline(job: ProcessingJob): string {
  switch (job.status) {
    // §21's words, verbatim. The only percentage is the upload's — measured, never invented.
    case "preparing":
      return "Preparing your video";
    case "uploading":
      return job.progress !== null ? `Uploading your media · ${Math.round(job.progress * 100)}%` : "Uploading your media";
    case "queued":
      return "Your creation is in the queue";
    case "processing":
      return "Replacing the character";
    case "finalizing":
      return "Finishing your video";
    default:
      return "Working";
  }
}

function eta(seconds: number): string {
  if (seconds < 60) return `${Math.max(5, Math.round(seconds / 5) * 5)} seconds`;
  const m = Math.round(seconds / 60);
  return `${m} ${m === 1 ? "minute" : "minutes"}`;
}
