"use client";

import { AlertTriangle, BellOff, BellRing, Check, Compass, History, RotateCcw, WifiOff, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { FrenzAICore } from "@/features/ai/core/frenz-ai-core";
import { enablePush, getPushState, type PushState } from "@/features/notifications/push";
import type { ReplacementMode } from "@/lib/ai/character-replace/modes";
import { stageSteps, type PipelineMeta } from "@/lib/ai/character-replace/pipeline";
import { isProcessingActive, type ProcessingJob } from "@/lib/ai/character-replace/types";
import { formatCents } from "@/lib/ai/economy";
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
  mode = "full_character",
  onCancel,
  onRetry,
  onDone,
  historyHref = "/ai/history",
  exploreHref = "/explore",
  symbol = "₦",
  previews = null,
  className,
}: {
  job: ProcessingJob;
  /** Which replacement (Part 6) — words the replacement step for it. */
  mode?: ReplacementMode;
  /** Present only where cancelling is technically safe (no charge left behind). */
  onCancel?: () => void;
  onRetry?: () => void;
  /** Complete: continue to the result. */
  onDone?: () => void;
  /** "View My Creations" (§27). */
  historyHref?: string;
  /** "Continue Exploring" (§27). */
  exploreHref?: string;
  /** The wallet's currency symbol, for the refund sentence (§29). */
  symbol?: string;
  /**
   * Part 9 §16: the character photo and the video, as object URLs the browser
   * still holds while the member stays on the page. Absent after a reload
   * (the result route) — then the hero is the stage and the mark alone.
   */
  previews?: { photoUrl: string | null; videoUrl: string | null } | null;
  className?: string;
}) {
  const active = isProcessingActive(job.status);
  const offline = useOffline();
  /*
    ── Part 6 §21: stage-based, from the job's OWN plan ─────────────────────
    The rows are the stages this job runs (a voice-from-text job has five, a
    plain one three), each done / doing / to come from the row's pipeline
    record — never from a timer. No percentages: the provider reports none,
    so none are shown.
  */
  const pipeline = toPipeline(job.job?.characterReplace?.pipeline ?? null);
  const steps = stageSteps({ status: job.status, pipeline, mode });
  const doing = steps.find((s) => s.state === "doing") ?? null;

  if (job.status === "failed" || job.status === "refunded" || job.status === "cancelled") {
    const cancelled = job.status === "cancelled";
    /*
      ── §29: THE REFUND LINE COMES FROM THE LEDGER ─────────────────────────
      `refunded` is true only once the ledger row flipped; `refundPending`
      while the charge is still reserved (the refund is on its way). A job
      that was never charged says so. Never "refunded" on a hope.
    */
    const facts = job.job?.characterReplace ?? null;
    const charged = (facts?.chargedCents ?? 0) > 0;
    const amount = charged ? formatCents(facts!.chargedCents!, symbol) : null;
    const refundLine = !charged
      ? "You weren't charged for it."
      : facts?.refunded
        ? `Your ${amount} balance has been refunded.`
        : facts?.refundPending
          ? "Your balance refund is being processed."
          : "Your balance will be refunded.";
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
        <h2 className="mt-4 text-[19px] font-bold tracking-[-0.02em]">{cancelled ? "Cancelled" : "We couldn't finish your video"}</h2>
        <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed text-muted-foreground">
          {cancelled ? "You stopped it before it started, so nothing was charged." : (job.message ?? "Something went wrong while processing your video.")}{" "}
          <span className={cn("font-semibold", facts?.refunded ? "text-emerald-600" : "text-foreground")}>{refundLine}</span>
        </p>
        {/* §25 — the money, as rows: the charge, and the refund only once the ledger confirms it */}
        {charged && facts ? (
          <dl className="mx-auto mt-4 max-w-xs space-y-1.5 rounded-2xl border border-border/60 bg-secondary/40 px-4 py-3 text-left text-[13px]">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">Processing charge</dt>
              <dd className="font-semibold tabular-nums">{amount}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">Refund</dt>
              <dd className={cn("font-semibold tabular-nums", facts.refunded ? "text-emerald-600" : "text-muted-foreground")}>
                {facts.refunded ? `${amount} ✓` : facts.refundPending ? "Being processed" : "On its way"}
              </dd>
            </div>
          </dl>
        ) : null}
        {onRetry ? (
          <button type="button" onClick={onRetry} className="btn-lux mt-5 bg-foreground text-background">
            <RotateCcw className="h-4 w-4" aria-hidden />
            Try again
          </button>
        ) : null}
        <p className="mt-3 text-[12px] text-muted-foreground/80">Trying again starts a fresh attempt with a new price check. Your draft is kept.</p>
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
      <div className="relative overflow-hidden px-5 pt-5">
        {/* the room's light — one soft gradient, opacity only under reduced motion */}
        <span aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[radial-gradient(closest-side,rgba(99,102,241,0.18),transparent)] blur-2xl" />
        <div className="relative flex items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-secondary/70">
            <FrenzAICore size="md" presence="working" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{stageWord(job.status)}</p>
            <h2 className="mt-0.5 text-[19px] font-bold leading-tight tracking-[-0.02em]">{job.status === "uploading" || job.status === "preparing" ? headline(job) : (doing?.label ?? headline(job))}</h2>
            {job.estimatedSecondsRemaining !== null ? (
              <p className="mt-1 text-[12.5px] text-muted-foreground">About {eta(job.estimatedSecondsRemaining)} left</p>
            ) : (
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                Step {Math.min(steps.length, steps.filter((s) => s.state === "done").length + 1)} of {steps.length}
              </p>
            )}
          </div>
          {previews && (previews.photoUrl || previews.videoUrl) ? (
            /* Part 9 §16: what is being made, from what — the two files the member chose */
            <div className="hidden shrink-0 items-center gap-1.5 min-[380px]:flex" aria-hidden>
              {previews.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previews.photoUrl} alt="" className="h-14 w-11 rounded-xl object-cover ring-1 ring-black/10 dark:ring-white/10" />
              ) : null}
              {previews.videoUrl ? (
                <video src={previews.videoUrl} muted playsInline preload="metadata" className="h-14 w-11 rounded-xl object-cover ring-1 ring-black/10 dark:ring-white/10" />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/*
        The bar — one segment per stage of THIS job, filled as stages finish,
        the current one sweeping. Stage-based, never a creeping percentage:
        the provider reports none (Part 9 §15).
      */}
      <div className="mx-5 mt-4 flex gap-1" role="progressbar" aria-label="Progress by stage" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={steps.filter((s) => s.state === "done").length}>
        {steps.map((s) => (
          <div key={s.key} className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
            {s.state === "done" ? (
              <div className="h-full w-full rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500" />
            ) : s.state === "doing" ? (
              <div className="frenz-loader-bar h-full w-2/5 rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500" />
            ) : null}
          </div>
        ))}
      </div>

      {/* the tracker — the job's own stages (§21) */}
      <ol className="mt-4 divide-y divide-border/60 border-t border-border/60">
        {steps.map((s, i) => {
          const done = s.state === "done";
          const working = s.state === "doing";
          return (
            <li key={s.key} className="flex items-center gap-3 px-5 py-2.5" aria-current={working ? "step" : undefined}>
              <span
                aria-hidden
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
                  done && "bg-emerald-500/15 text-emerald-600",
                  working && "bg-foreground text-background",
                  !done && !working && "bg-secondary text-muted-foreground/60",
                )}
              >
                {done ? <Check className="h-3 w-3" strokeWidth={3} /> : working ? <span className="frenz-pulse-dot block h-2 w-2 rounded-full bg-background" /> : i + 1}
              </span>
              <span className={cn("text-[13.5px]", working ? "font-bold" : done ? "text-muted-foreground" : "text-muted-foreground/60")}>
                {done ? s.doneLabel : s.label}
                {working ? <span className="ml-2 text-[11.5px] font-semibold text-primary">Working…</span> : !done ? <span className="ml-2 text-[11.5px] text-muted-foreground/60">Waiting</span> : null}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="border-t border-border/60 px-5 py-4">
        {job.job ? (
          /* §27 — the server owns the job now; the member is free to go. */
          <LeaveCard historyHref={historyHref} exploreHref={exploreHref} />
        ) : (
          <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-muted-foreground">
            <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-primary/70" aria-hidden />
            Keep this page open until the upload finishes — after that the work continues on our side.
          </p>
        )}
        {offline ? (
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-[12.5px] leading-relaxed text-amber-700 dark:text-amber-300" role="status">
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            You&apos;re offline. Your video keeps processing — we&apos;ll check again the moment you reconnect.
          </p>
        ) : null}
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

/** The row's pipeline summary (statuses only) as the pure stage functions read it. */
function toPipeline(p: NonNullable<NonNullable<ProcessingJob["job"]>["characterReplace"]>["pipeline"] | null): PipelineMeta | null {
  if (!p) return null;
  const records: PipelineMeta["records"] = {};
  for (const [k, status] of Object.entries(p.records)) if (status) records[k as keyof PipelineMeta["records"]] = { status };
  return { stages: p.stages, current: p.current, records };
}

function stageWord(status: ProcessingJob["status"]): string {
  switch (status) {
    case "preparing":
      return "Preparing";
    case "uploading":
      return "Uploading";
    case "queued":
      return "Starting";
    case "processing":
      return "In progress";
    case "finalizing":
      return "Finalizing";
    default:
      return "Working";
  }
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

/* ───────────────────────────── §27: leaving the app ───────────────────────── */

function LeaveCard({ historyHref, exploreHref }: { historyHref: string; exploreHref: string }) {
  const push = usePushState();
  return (
    <div className="rounded-2xl bg-secondary/50 px-4 py-3.5">
      <p className="text-[13.5px] font-bold tracking-[-0.01em]">Your video is processing</p>
      <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
        You can leave FrenzSave. We&apos;ll notify you when it&apos;s ready.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href={historyHref} prefetch={false} className="btn-lux min-h-[42px] border border-border/70 bg-card px-4 text-[13px] text-foreground hover:border-foreground/25">
          <History className="h-4 w-4" aria-hidden />
          View My Creations
        </Link>
        <Link href={exploreHref} prefetch={false} className="btn-lux min-h-[42px] border border-transparent px-4 text-[13px] text-muted-foreground hover:bg-card hover:text-foreground">
          <Compass className="h-4 w-4" aria-hidden />
          Continue Exploring
        </Link>
      </div>
      {push.state === "default" || push.state === "unsubscribed" ? (
        /* §22 — asked here, where it is relevant, never forced. */
        <button
          type="button"
          onClick={() => void push.enable()}
          disabled={push.busy}
          className="mt-3 flex items-center gap-2 text-left text-[12.5px] font-semibold text-primary underline-offset-4 hover:underline disabled:opacity-60"
        >
          <BellRing className="h-3.5 w-3.5" aria-hidden />
          {push.busy ? "Turning on notifications…" : "Turn on notifications to hear when it's ready"}
        </button>
      ) : push.state === "denied" ? (
        <p className="mt-3 flex items-start gap-2 text-[12px] leading-relaxed text-muted-foreground/80">
          <BellOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Notifications are off for FrenzSave in your device settings — your video will still be waiting under My Creations.
        </p>
      ) : null}
    </div>
  );
}

function usePushState() {
  const [state, setState] = useState<PushState | "unknown">("unknown");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void getPushState().then((s) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const enable = async () => {
    setBusy(true);
    try {
      setState(await enablePush());
    } catch {
      setState(await getPushState());
    } finally {
      setBusy(false);
    }
  };
  return { state, busy, enable };
}

function useOffline(): boolean {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const sync = () => setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  return offline;
}
