"use client";

import { Check, Loader2, X } from "lucide-react";

import { AI_CLEAN_PATH, pathState, type StageView } from "@/lib/ai/job-stages";
import { cn } from "@/lib/utils";

/**
 * What a member watches while their video is being cleaned.
 *
 * ── 🔴 NO INVENTED PERCENTAGE, AND NO INVENTED STAGE ─────────────────────────
 *
 * The bar moves when the job's real state changes, and during the upload it
 * follows bytes the browser has actually sent. It never creeps on a timer to
 * look busy. The six steps below are the JOURNEY, always all visible, and the
 * ones we cannot individually observe are never announced as the current
 * one — see lib/ai/job-stages.ts for exactly which those are and why.
 *
 * The honest cost of that: while the model runs, three steps light up together
 * rather than one after another. A member sees where they are; nobody is told a
 * thing we do not know.
 *
 * ── Motion ───────────────────────────────────────────────────────────────────
 *
 * A width transition on the bar and a spinner on the active step. No looping
 * shimmer down the whole panel: this screen can be open for ten minutes on a
 * phone, and a permanent animation is a permanent battery cost.
 */
export function AICleanProcessing({
  view,
  fileName,
  onCancel,
  cancelling,
}: {
  view: StageView;
  fileName: string | null;
  onCancel?: () => void;
  cancelling?: boolean;
}) {
  const steps = pathState(view.stage);
  const percent = view.progress === null ? 0 : Math.round(view.progress * 100);

  return (
    <div className="p-4 sm:p-6">
      <div className="mx-auto max-w-xl py-2 sm:py-6">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary motion-reduce:animate-none" aria-hidden />
          <h2 className="text-lg font-bold tracking-[-0.01em]">{view.label}</h2>
        </div>

        {fileName ? (
          <p className="mt-1 truncate text-sm text-muted-foreground" title={fileName}>
            {fileName}
          </p>
        ) : null}

        {/*
          One live region for the whole panel. Announcing each step separately
          would talk over somebody using a screen reader every few seconds; the
          heading changing is the news.
        */}
        <div
          role="status"
          aria-live="polite"
          className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-secondary"
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-600 to-violet-500 transition-[width] duration-500 ease-out motion-reduce:transition-none"
            style={{ width: `${Math.max(4, percent)}%` }}
          />
          <span className="sr-only">{view.label}</span>
        </div>

        {view.detail ? (
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{view.detail}</p>
        ) : null}

        <ol className="mt-5 space-y-2.5">
          {AI_CLEAN_PATH.map((step) => {
            const state = steps[step.key] ?? "todo";
            return (
              <li key={step.key} className="flex items-center gap-2.5 text-sm">
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                    state === "done" && "bg-primary/15 text-primary",
                    state === "doing" && "bg-primary text-primary-foreground",
                    state === "todo" && "bg-secondary text-muted-foreground",
                  )}
                >
                  {state === "done" ? <Check className="h-3 w-3" aria-hidden /> : null}
                </span>
                <span className={cn(state === "todo" ? "text-muted-foreground" : "font-medium")}>
                  {step.label}
                </span>
              </li>
            );
          })}
        </ol>

        <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
          You can leave this page. The work carries on, and it will be here when you come back.
        </p>

        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={cancelling}
            className="btn-lux btn-lux-secondary mt-5 text-muted-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
            {cancelling ? "Stopping…" : "Cancel"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
