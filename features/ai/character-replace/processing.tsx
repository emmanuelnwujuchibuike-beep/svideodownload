"use client";

import { AlertTriangle, BellOff, BellRing, Check, Compass, History, RotateCcw, WifiOff, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { FrenzAICore } from "@/features/ai/core/frenz-ai-core";
import { enablePush, getPushState, type PushState } from "@/features/notifications/push";
import { PROCESSING_STAGES, isProcessingActive, type ProcessingJob } from "@/lib/ai/character-replace/types";
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
  onCancel,
  onRetry,
  onDone,
  historyHref = "/ai/history",
  exploreHref = "/explore",
  symbol = "₦",
  className,
}: {
  job: ProcessingJob;
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
  className?: string;
}) {
  const active = isProcessingActive(job.status);
  const stage = PROCESSING_STAGES.find((s) => s.key === job.status);
  const currentIndex = PROCESSING_STAGES.findIndex((s) => s.key === job.status);
  const offline = useOffline();

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
