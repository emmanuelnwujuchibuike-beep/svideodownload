"use client";

import { ArrowLeft, Check, Clapperboard, Download, History, Loader2, RotateCcw, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { startAiResultDownload } from "@/features/ai/ai-result-download";
import { useBatchWatch } from "@/features/ai/character-replace/use-batch-watch";
import { FrenzAICore } from "@/features/ai/core/frenz-ai-core";
import { batchHeadline, summarizeBatch } from "@/lib/ai/character-replace/batch";
import { getCharacterReplaceQuote, preflightCharacterReplaceJob, retryCharacterReplaceJob, startCharacterReplaceBatch } from "@/lib/ai/character-replace/client";
import { replacementModeLabel } from "@/lib/ai/character-replace/modes";
import type { CharacterReplaceAnyQuality } from "@/lib/ai/character-replace/pricing";
import { deleteAiJob } from "@/lib/ai/client";
import { formatCents } from "@/lib/ai/economy";
import { isActiveStatus, type AiJobStatus, type AiJobView } from "@/lib/ai/jobs";
import { track } from "@/lib/analytics/client";
import { haptic } from "@/lib/motion/haptics";
import { cn, formatBytes } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE BATCH BOARD — every video of the session, from the server, truthfully
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-21 (multi-video brief §9–§14): one card per video with its
 * real server state — Waiting in queue · Preparing · Processing · Finishing
 * · Ready · Didn't finish · Cancelled — a summary line ("3 videos · 2
 * processing · 1 waiting"), Download / Download all, Cancel, Retry, Delete.
 *
 * 🔴 NO PERCENTAGES. The provider reports none; a moving stripe says "this
 * is running" and the words say what. The only figure ever shown is real.
 *
 * Everything on this screen comes from one poll of the batch route
 * (use-batch-watch.ts) — a refresh, a new tab, another device reconstruct
 * the same picture because the picture IS the rows.
 */
export function CharacterReplaceBatchBoard({
  batchId,
  symbol,
  historyHref,
  resultHrefFor,
  onLeave,
  onRetryInEditor,
  className,
}: {
  batchId: string;
  symbol: string;
  historyHref: string;
  /** The result route for one finished video (Part 7). */
  resultHrefFor: (jobId: string) => string;
  /** Back to the workspace — for more videos (the photo may still be in hand). */
  onLeave: () => void;
  /** A retry that needs the editor (a new-voice job whose dialogue is not on the board). */
  onRetryInEditor: (jobId: string) => void;
  className?: string;
}) {
  const watch = useBatchWatch(batchId);
  const jobs = useMemo(() => [...watch.jobs].sort((a, b) => (a.batch?.index ?? 0) - (b.batch?.index ?? 0)), [watch.jobs]);
  const summary = useMemo(() => summarizeBatch(batchId, jobs), [batchId, jobs]);
  const completed = jobs.filter((j) => j.status === "completed");
  const [busy, setBusy] = useState<Record<string, "cancel" | "retry" | "delete" | undefined>>({});
  const [notes, setNotes] = useState<Record<string, string | undefined>>({});
  const mark = (id: string, what: "cancel" | "retry" | "delete" | undefined) => setBusy((b) => ({ ...b, [id]: what }));
  const note = (id: string, text: string | undefined) => setNotes((n) => ({ ...n, [id]: text }));

  const cancel = useCallback(
    async (job: AiJobView) => {
      if (!window.confirm(job.status === "waiting" || job.status === "queued" || job.status === "acquiring" ? "Cancel this video? Nothing will be charged for it." : "Stop this video? It has already been sent for processing; your charge will be returned per our refund policy.")) return;
      mark(job.id, "cancel");
      haptic("medium");
      track("character_replace_batch_cancel", { status: job.status });
      const ok = await watch.cancel(job.id);
      mark(job.id, undefined);
      if (!ok) note(job.id, "Couldn't cancel just now. Try again.");
    },
    [watch],
  );

  /**
   * Retry from the board (brief §13): a new attempt whose files the server
   * copies, checked and started with a fresh price — the same spend sequence
   * as any start, nothing charged twice. A new-voice job needs its dialogue,
   * which lives in the editor; that one goes back there.
   */
  const retry = useCallback(
    async (job: AiJobView) => {
      const cr = job.characterReplace;
      if (!cr) return;
      if (cr.voiceMode === "new_voice") {
        onRetryInEditor(job.id);
        return;
      }
      mark(job.id, "retry");
      note(job.id, undefined);
      haptic("light");
      track("character_replace_batch_retry", { mode: cr.mode });
      try {
        const opened = await retryCharacterReplaceJob(job.id);
        if (!opened.ok) {
          note(job.id, opened.error);
          return;
        }
        const fresh = opened.job;
        const checked = await preflightCharacterReplaceJob(fresh.id);
        if (!checked.ok) {
          note(job.id, checked.error);
          return;
        }
        if (!checked.preflight.valid || !checked.token) {
          note(job.id, checked.preflight.headline?.title ?? "This video didn't pass the media check.");
          return;
        }
        const durationMs = Math.round((cr.selectedDurationMs ?? (fresh.source.durationSeconds ?? 0) * 1000) || 0);
        const quoted = await getCharacterReplaceQuote({ selectedDurationMs: durationMs, mode: cr.mode, quality: cr.quality as CharacterReplaceAnyQuality, voiceMode: "original", voiceSource: null, ttsCharacters: 0, voiceChange: false, lipSyncMode: null });
        if (!quoted.ok) {
          note(job.id, quoted.error);
          return;
        }
        const q = quoted.quote;
        const started = await startCharacterReplaceBatch(batchId, {
          consent: true,
          jobs: [{ jobId: fresh.id, preflightToken: checked.token, quote: { id: q.id, product: "character_replace", currency: q.currency, pricingConfigVersion: q.pricingConfigVersion, durationMs: q.durationMs, mode: q.mode, quality: q.quality, voiceMode: q.voiceMode, voiceSource: q.voiceSource, ttsCharacters: q.ttsCharacters, voiceChange: q.voiceChange === true, lipSyncMode: q.lipSyncMode, totalCents: q.totalCents, expiresAt: q.expiresAt } }],
        });
        if (!started.ok) {
          note(job.id, started.error);
          return;
        }
        const r = started.results[0];
        if (r && !r.ok) note(job.id, r.error ?? "Couldn't start the retry.");
        watch.refresh();
      } finally {
        mark(job.id, undefined);
      }
    },
    [batchId, onRetryInEditor, watch],
  );

  const remove = useCallback(
    async (job: AiJobView) => {
      if (!window.confirm("Delete this video from FrenzSave? Your charge record is kept.")) return;
      mark(job.id, "delete");
      const res = await deleteAiJob(job.id);
      mark(job.id, undefined);
      if (!res.ok) note(job.id, res.error);
      watch.refresh();
    },
    [watch],
  );

  const downloadAll = useCallback(() => {
    haptic("light");
    for (const job of completed) startAiResultDownload(job);
  }, [completed]);

  if (watch.missing) {
    return (
      <section className={cn("rounded-[1.5rem] border border-border/70 bg-card px-5 py-6", className)}>
        <p className="text-[15px] font-bold">We couldn&apos;t find those videos</p>
        <p className="mt-1 text-[12.5px] text-muted-foreground">They may belong to another account, or the session has been cleared.</p>
        <button type="button" onClick={onLeave} className="btn-lux mt-4 bg-foreground text-background">
          Back to Character Replace
        </button>
      </section>
    );
  }

  const running = summary.counts.processing > 0 || summary.counts.waiting > 0;

  return (
    <section aria-live="polite" aria-busy={summary.active} className={cn("space-y-3", className)}>
      {/* the summary (brief §10) */}
      <div className="relative overflow-hidden rounded-[1.5rem] border border-border/70 bg-card px-5 py-5">
        <span aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[radial-gradient(closest-side,rgba(99,102,241,0.16),transparent)] blur-2xl" />
        <div className="relative flex items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-secondary/70">
            <FrenzAICore size="md" presence={running ? "working" : summary.counts.failed > 0 ? "faulted" : "settled"} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{running ? "In progress" : "Finished"}</p>
            <h2 className="mt-0.5 text-[19px] font-bold leading-tight tracking-[-0.02em]">{jobs.length ? batchHeadline(summary) : "Loading your videos…"}</h2>
            {running ? <p className="mt-1 text-[12.5px] text-muted-foreground">You can close FrenzSave — each video starts by itself and we&apos;ll notify you as they finish.</p> : null}
          </div>
        </div>
        {/* one segment per video, by real state — never a percentage */}
        {jobs.length ? (
          <div className="mt-4 flex gap-1" role="img" aria-label={batchHeadline(summary)}>
            {jobs.map((j) => (
              <span key={j.id} className={cn("h-1.5 flex-1 overflow-hidden rounded-full", segmentTone(j.status))}>
                {j.status === "acquiring" || j.status === "processing" || j.status === "finalizing" ? <span className="frenz-loader-bar block h-full w-2/5 rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500" /> : null}
              </span>
            ))}
          </div>
        ) : null}
        <dl className="mt-4 grid grid-cols-4 gap-2 text-center">
          <Count label="Videos" value={summary.size} />
          <Count label="Processing" value={summary.counts.processing} tone={summary.counts.processing ? "live" : undefined} />
          <Count label="Waiting" value={summary.counts.waiting} />
          <Count label="Done" value={summary.counts.completed} tone={summary.counts.completed ? "good" : undefined} />
        </dl>
      </div>

      {/* the cards (brief §9, §11) */}
      <ul className="space-y-2.5">
        {jobs.map((job) => {
          const cr = job.characterReplace;
          const live = isActiveStatus(job.status);
          const state = stateWords(job);
          const b = busy[job.id];
          return (
            <li key={job.id} className="overflow-hidden rounded-[1.35rem] border border-border/70 bg-card">
              <div className="flex items-start gap-3 px-4 pt-4">
                {/* thumbnail: the real poster once there is one, a plate before that */}
                <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded-xl bg-[#0b0f1a] ring-1 ring-black/10 dark:ring-white/10">
                  {job.status === "completed" && job.result.hasPoster ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/ai/jobs/${encodeURIComponent(job.id)}/poster`} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Clapperboard className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 text-white/60" aria-hidden />
                  )}
                  {job.batch ? <span className="absolute bottom-0 left-0 right-0 bg-black/55 py-0.5 text-center text-[10px] font-bold tabular-nums text-white">{job.batch.index}</span> : null}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold" title={job.source.name ?? undefined}>
                    {job.source.name ?? "Video"}
                  </p>
                  <p className={cn("mt-0.5 text-[12.5px] font-semibold", state.tone)}>
                    {state.label}
                    {job.characterReplace?.attempt && job.characterReplace.attempt > 1 ? <span className="ml-1 font-normal text-muted-foreground">· attempt {job.characterReplace.attempt}</span> : null}
                  </p>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                    {cr ? replacementModeLabel(cr.mode) : null}
                    {cr?.quality ? ` · ${cr.quality}` : null}
                    {job.source.size ? ` · ${formatBytes(job.source.size)}` : null}
                    {cr ? ` · ${cr.billing === "FREE_TRIAL" ? "Complimentary" : cr.chargedCents !== null && cr.chargedCents > 0 ? formatCents(cr.chargedCents, symbol) : cr.normalPriceCents ? formatCents(cr.normalPriceCents, symbol) : ""}` : null}
                    {cr?.refunded ? " · refunded" : cr?.refundPending ? " · refund on its way" : cr?.freeRestored ? " · creation restored" : null}
                  </p>
                  {state.detail ? <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{state.detail}</p> : null}
                  {notes[job.id] ? <p className="mt-1 text-[12px] font-semibold text-rose-500">{notes[job.id]}</p> : null}
                </div>
              </div>
              {/* the moving stripe: something is running; the flat one: it is in line */}
              {live ? (
                <div className="mx-4 mt-3 h-1 overflow-hidden rounded-full bg-secondary" aria-hidden>
                  {job.status === "waiting" || job.status === "queued" ? <span className="block h-full w-1/4 rounded-full bg-amber-400/70" /> : <span className="frenz-loader-bar block h-full w-2/5 rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500" />}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2 px-4 pb-3.5 pt-3">
                {job.status === "completed" ? (
                  <>
                    <Link href={resultHrefFor(job.id)} prefetch={false} className="btn-lux min-h-[42px] bg-foreground px-4 text-[13px] text-background">
                      View
                    </Link>
                    <button type="button" onClick={() => startAiResultDownload(job)} className="btn-lux min-h-[42px] border border-border/70 bg-card px-4 text-[13px] text-foreground hover:border-foreground/25">
                      <Download className="h-4 w-4" aria-hidden />
                      Download
                    </button>
                    <button type="button" onClick={() => void remove(job)} disabled={!!b} className="btn-lux min-h-[42px] border border-transparent px-3 text-[13px] text-muted-foreground hover:bg-secondary hover:text-foreground">
                      {b === "delete" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
                      Delete
                    </button>
                  </>
                ) : null}
                {live && job.status !== "queued" ? (
                  <button type="button" onClick={() => void cancel(job)} disabled={!!b} className="btn-lux min-h-[42px] border border-border/70 bg-card px-4 text-[13px] text-foreground hover:border-foreground/25">
                    {b === "cancel" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <X className="h-4 w-4" aria-hidden />}
                    {job.status === "waiting" ? "Remove from queue" : "Cancel"}
                  </button>
                ) : null}
                {job.status === "failed" || job.status === "expired" || job.status === "cancelled" ? (
                  <button type="button" onClick={() => void retry(job)} disabled={!!b} className="btn-lux min-h-[42px] bg-foreground px-4 text-[13px] text-background">
                    {b === "retry" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
                    Retry
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {/* the footer */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {completed.length >= 2 ? (
          <button type="button" onClick={downloadAll} className="btn-lux min-h-[46px] bg-foreground px-5 text-[13.5px] text-background">
            <Download className="h-4 w-4" aria-hidden />
            Download all ({completed.length})
          </button>
        ) : null}
        <button type="button" onClick={onLeave} className="btn-lux min-h-[46px] border border-border/70 bg-card px-4 text-[13.5px] text-foreground hover:border-foreground/25">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          More videos
        </button>
        <Link href={historyHref} prefetch={false} className="btn-lux min-h-[46px] border border-transparent px-4 text-[13.5px] text-muted-foreground hover:bg-secondary hover:text-foreground">
          <History className="h-4 w-4" aria-hidden />
          My Creations
        </Link>
        {summary.counts.completed === summary.size && summary.size > 0 ? (
          <span className="ml-auto inline-flex items-center gap-1 text-[12.5px] font-semibold text-emerald-600">
            <Check className="h-4 w-4" aria-hidden /> All done
          </span>
        ) : null}
      </div>
      {watch.error ? <p className="text-[12px] text-muted-foreground">Last update didn&apos;t arrive ({watch.error}). Still trying.</p> : null}
    </section>
  );
}

/** The member's words for a job's real state — never a percentage, never a guess. */
function stateWords(job: AiJobView): { label: string; detail: string | null; tone: string } {
  switch (job.status) {
    case "queued":
      return { label: "Not started", detail: "This one wasn't started. Retry it or remove it.", tone: "text-muted-foreground" };
    case "waiting":
      return { label: "Waiting in queue", detail: "Starts automatically when one of your videos finishes.", tone: "text-amber-700 dark:text-amber-400" };
    case "acquiring":
      return { label: "Preparing", detail: null, tone: "text-primary" };
    case "processing":
      return { label: "Processing", detail: null, tone: "text-primary" };
    case "finalizing":
      return { label: "Finishing", detail: null, tone: "text-primary" };
    case "completed":
      return { label: "Ready", detail: null, tone: "text-emerald-600" };
    case "failed":
    case "expired":
      return { label: "Didn't finish", detail: job.error?.message ?? null, tone: "text-rose-500" };
    case "cancelled":
      return { label: "Cancelled", detail: null, tone: "text-muted-foreground" };
    case "deleted":
      return { label: "Deleted", detail: null, tone: "text-muted-foreground" };
  }
}

function segmentTone(status: AiJobStatus): string {
  switch (status) {
    case "completed":
      return "bg-emerald-500";
    case "failed":
    case "expired":
      return "bg-rose-400";
    case "cancelled":
    case "deleted":
      return "bg-secondary";
    case "waiting":
    case "queued":
      return "bg-amber-300/70";
    default:
      return "bg-secondary";
  }
}

function Count({ label, value, tone }: { label: string; value: number; tone?: "live" | "good" }) {
  return (
    <div className="rounded-2xl bg-secondary/50 px-2 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 text-[17px] font-bold tabular-nums", tone === "live" && "text-primary", tone === "good" && "text-emerald-600")}>{value}</dd>
    </div>
  );
}
