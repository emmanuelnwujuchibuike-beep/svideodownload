"use client";

import { Check, X } from "lucide-react";

import { FrenzAICore } from "@/features/ai/core/frenz-ai-core";
import { AI_CLEAN_PATH, pathState, type StageView } from "@/lib/ai/job-stages";
import { presenceFor } from "@/lib/ai/presence";
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
 * The Core replaced the spinner (2026-09-07). A spinner says "something is
 * happening somewhere"; the Core says which state the environment is in, and it
 * says it in the same visual language as every other Frenz AI surface — it
 * brightens and quickens as the work moves from queued to finalizing, driven
 * entirely by CSS variables rather than by React re-rendering an animation.
 *
 * Beyond that: a width transition on the bar, and nothing else. This screen can
 * be open for ten minutes on a phone, and a looping shimmer down the whole panel
 * would be a permanent battery cost for decoration.
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
        <div className="flex flex-col items-center text-center">
          <FrenzAICore presence={presenceFor({ stage: view.stage })} size="lg" />
          <h2 className="mt-4 text-lg font-bold tracking-[-0.01em]">{view.label}</h2>
          {fileName ? (
            <p className="mt-1 max-w-full truncate text-sm text-muted-foreground" title={fileName}>
              {fileName}
            </p>
          ) : null}
        </div>

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
          <p className="mt-3 text-center text-sm leading-relaxed text-muted-foreground">{view.detail}</p>
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

        <p className="mt-5 text-center text-xs leading-relaxed text-muted-foreground">
          You can leave this page. The work carries on, and it will be here when you come back.
        </p>

        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={cancelling}
            className="btn-lux btn-lux-secondary mx-auto mt-5 flex text-muted-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
            {cancelling ? "Stopping…" : "Cancel"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
