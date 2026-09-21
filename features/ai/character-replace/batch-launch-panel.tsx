"use client";

import { AlertTriangle, ArrowLeft, Check, Loader2, Sparkles, Upload } from "lucide-react";

import type { BatchLaunchItem, BatchLaunchState } from "@/features/ai/character-replace/use-character-replace-batch";
import { formatCents } from "@/lib/ai/economy";
import { cn } from "@/lib/utils";

/**
 * The multi-video launch (0166): the session leaving the device — one row
 * per video with its upload (the one measured progress there is), its
 * media check, and its verdict — then the confirm that spends, or the
 * attention list when a video did not pass.
 *
 * Nothing on this screen has charged anything until "Process N videos" on
 * the ready state; the server re-verifies every quote and pass then.
 */
export function CharacterReplaceBatchLaunchPanel({
  launch,
  totalCents,
  complimentaryCount,
  symbol,
  balanceCents,
  onConfirm,
  onDropFailedAndConfirm,
  onBack,
  onRetry,
}: {
  launch: Exclude<BatchLaunchState, { phase: "idle" }>;
  totalCents: number | null;
  complimentaryCount: number;
  symbol: string;
  balanceCents: number | null;
  onConfirm: () => void;
  onDropFailedAndConfirm: () => void;
  onBack: () => void;
  onRetry: () => void;
}) {
  if (launch.phase === "error") {
    return (
      <section className="mt-5 rounded-[1.5rem] border border-rose-400/40 bg-card px-5 py-5">
        <p className="flex items-center gap-2 text-[15px] font-bold">
          <AlertTriangle className="h-4 w-4 text-rose-500" aria-hidden />
          Couldn&apos;t continue
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{launch.message}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={onRetry} className="btn-lux min-h-[46px] bg-foreground px-5 text-background">
            Try again
          </button>
          <button type="button" onClick={onBack} className="btn-lux min-h-[46px] border border-border/70 bg-card px-4 text-foreground hover:border-foreground/25">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back
          </button>
        </div>
      </section>
    );
  }
  if (launch.phase === "creating") {
    return (
      <section className="mt-5 rounded-[1.5rem] border border-border/70 bg-card px-5 py-6 text-center" aria-busy="true">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary motion-reduce:animate-none" aria-hidden />
        <p className="mt-3 text-[15px] font-bold">Preparing {launch.total} videos</p>
        <p className="mt-1 text-[12.5px] text-muted-foreground">Opening a job for each one. Nothing is charged yet.</p>
      </section>
    );
  }

  const items = launch.items;
  const passing = items.filter((i) => i.phase === "ready");
  const failing = items.filter((i) => i.phase === "attention" || i.phase === "error");
  const busy = launch.phase === "uploading" || launch.phase === "checking" || launch.phase === "starting";
  const paidTotal = totalCents;
  const short = paidTotal !== null && balanceCents !== null && balanceCents < paidTotal && complimentaryCount < items.length;

  return (
    <section className="mt-5 rounded-[1.5rem] border border-border/70 bg-card" aria-live="polite" aria-busy={busy}>
      <header className="px-5 pt-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          {launch.phase === "uploading" ? "Uploading" : launch.phase === "checking" ? "Checking your media" : launch.phase === "starting" ? "Starting" : launch.phase === "attention" ? "Needs attention" : "Ready to process"}
        </p>
        <h2 className="mt-0.5 text-[19px] font-bold leading-tight tracking-[-0.02em]">
          {launch.phase === "uploading"
            ? `Sending ${items.length} videos to private storage`
            : launch.phase === "checking"
              ? "Making sure every video will work"
              : launch.phase === "starting"
                ? `Starting ${passing.length} videos`
                : launch.phase === "attention"
                  ? `${failing.length} of ${items.length} ${failing.length === 1 ? "video needs" : "videos need"} a look`
                  : `${items.length} videos passed the check`}
        </h2>
        {launch.phase === "ready" ? <p className="mt-1 text-[12.5px] text-muted-foreground">Same photo and settings for every video. Your plan&apos;s slots run first; the rest wait in your own line and start by themselves.</p> : null}
      </header>

      <ul className="mt-4 divide-y divide-border/60 border-t border-border/60">
        {items.map((it) => (
          <Row key={it.index} item={it} />
        ))}
      </ul>

      {launch.phase === "ready" || launch.phase === "attention" ? (
        <div className="px-5 pb-5 pt-4">
          {paidTotal !== null ? (
            <dl className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-2xl bg-secondary/50 px-4 py-3">
              <dt className="text-[12.5px] font-semibold text-muted-foreground">
                {passing.length} video{passing.length === 1 ? "" : "s"}
                {complimentaryCount > 0 ? ` · ${Math.min(complimentaryCount, passing.length)} complimentary` : ""}
              </dt>
              <dd className="text-[17px] font-bold tabular-nums">{formatCents(paidTotal, symbol)}</dd>
              {balanceCents !== null ? <dd className={cn("w-full text-[11.5px]", short ? "font-semibold text-rose-500" : "text-muted-foreground")}>{short ? `Your balance is ${formatCents(balanceCents, symbol)} — recharge to process all of them.` : `Balance ${formatCents(balanceCents, symbol)} · charged per video as each one starts`}</dd> : null}
            </dl>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {launch.phase === "ready" ? (
              <button
                type="button"
                onClick={onConfirm}
                disabled={short}
                className={cn(
                  "inline-flex min-h-[50px] items-center gap-2 rounded-full px-6 text-[14px] font-bold text-white",
                  "bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500 shadow-[0_14px_34px_-14px_rgb(99_102_241/0.9)]",
                  "transition motion-safe:hover:-translate-y-0.5 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none",
                )}
              >
                <Sparkles className="h-4 w-4" aria-hidden />
                Process {items.length} videos{paidTotal !== null ? ` · ${formatCents(paidTotal, symbol)}` : ""}
              </button>
            ) : passing.length > 0 ? (
              <button
                type="button"
                onClick={onDropFailedAndConfirm}
                disabled={short}
                className={cn(
                  "inline-flex min-h-[50px] items-center gap-2 rounded-full px-6 text-[14px] font-bold text-white",
                  "bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500 shadow-[0_14px_34px_-14px_rgb(99_102_241/0.9)] transition active:scale-[0.99] disabled:opacity-45",
                )}
              >
                <Sparkles className="h-4 w-4" aria-hidden />
                Process the {passing.length} that passed
              </button>
            ) : null}
            <button type="button" onClick={onBack} className="btn-lux min-h-[46px] border border-border/70 bg-card px-4 text-foreground hover:border-foreground/25">
              <ArrowLeft className="h-4 w-4" aria-hidden />
              {launch.phase === "attention" ? "Change files" : "Back"}
            </button>
          </div>
          {launch.phase === "attention" ? (
            <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">The videos that didn&apos;t pass are left out and nothing is charged for them. Change the photo or the video and try them again on their own.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Row({ item }: { item: BatchLaunchItem }) {
  const pct = Math.round(item.uploadProgress * 100);
  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
          item.phase === "ready" ? "bg-emerald-500/10 text-emerald-600" : item.phase === "attention" || item.phase === "error" ? "bg-rose-500/10 text-rose-500" : "bg-secondary text-muted-foreground",
        )}
      >
        {item.phase === "ready" ? <Check className="h-4 w-4" aria-hidden /> : item.phase === "attention" || item.phase === "error" ? <AlertTriangle className="h-4 w-4" aria-hidden /> : item.phase === "uploading" ? <Upload className="h-4 w-4" aria-hidden /> : item.phase === "checking" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <span className="text-[11px] font-bold tabular-nums">{item.index + 1}</span>}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-semibold" title={item.name}>
          {item.name}
        </p>
        <p className={cn("mt-0.5 text-[11.5px]", item.phase === "attention" || item.phase === "error" ? "font-semibold text-rose-500" : "text-muted-foreground")}>
          {item.phase === "pending"
            ? "Waiting to upload"
            : item.phase === "uploading"
              ? `Uploading · ${pct}%`
              : item.phase === "checking"
                ? "Checking…"
                : item.phase === "ready"
                  ? "Passed"
                  : (item.message ?? "Needs attention")}
        </p>
        {item.phase === "uploading" ? (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className="h-full rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500 transition-[width] duration-200" style={{ width: `${pct}%` }} />
          </div>
        ) : null}
        {item.phase === "attention" && item.preflight?.issues?.length ? (
          <ul className="mt-1 space-y-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
            {item.preflight.issues.slice(0, 2).map((i) => (
              <li key={i.code}>{i.body}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}
