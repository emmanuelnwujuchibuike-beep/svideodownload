"use client";

import { Check } from "lucide-react";

import { stepIndex, WORKSPACE_STEPS, type WorkspaceStep } from "@/lib/ai/character-replace/workspace";
import { cn } from "@/lib/utils";

/**
 * The five steps, as a rail across the top of the workspace.
 *
 * A finished step is a button that goes back to it; the current step carries
 * `aria-current="step"`; a step not yet earned is static text. The line under
 * the labels is the only motion — its width follows the current step, and it
 * stops under reduced motion.
 *
 * At 360px five labels do not fit beside their numbers, so on a phone the
 * rail shows the numbers and ONE label (the current step's); from `sm` up
 * every label is printed. The numbers alone are enough to say "3 of 5".
 */
export function CharacterReplaceStepper({
  current,
  furthest,
  onGo,
  className,
}: {
  current: WorkspaceStep;
  /** The furthest step the member may open. */
  furthest: WorkspaceStep;
  onGo: (step: WorkspaceStep) => void;
  className?: string;
}) {
  const currentIndex = stepIndex(current);
  const furthestIndex = stepIndex(furthest);
  const progress = (currentIndex / (WORKSPACE_STEPS.length - 1)) * 100;

  return (
    <nav aria-label="Steps" className={cn("relative", className)}>
      <ol className="flex items-start justify-between gap-1">
        {WORKSPACE_STEPS.map((step, i) => {
          const done = i < currentIndex;
          const active = i === currentIndex;
          const reachable = i <= furthestIndex && !active;
          const inner = (
            <>
              <span
                aria-hidden
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold tabular-nums transition-colors duration-200",
                  active && "bg-foreground text-background",
                  done && "bg-primary/12 text-primary dark:bg-primary/20",
                  !active && !done && "bg-secondary text-muted-foreground",
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
              </span>
              <span
                className={cn(
                  "mt-1.5 text-[11.5px] font-semibold leading-none tracking-[-0.01em]",
                  active ? "text-foreground" : "text-muted-foreground",
                  // Phones: the current label only. Wider: every label.
                  !active && "hidden sm:block",
                )}
              >
                {step.label}
              </span>
            </>
          );
          return (
            <li key={step.id} className="flex min-w-0 flex-1 flex-col items-center" aria-current={active ? "step" : undefined}>
              {reachable ? (
                <button
                  type="button"
                  onClick={() => onGo(step.id)}
                  className="flex min-h-[44px] flex-col items-center rounded-xl px-2 outline-none transition hover:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Back to ${step.label}`}
                >
                  {inner}
                </button>
              ) : (
                <span className="flex min-h-[44px] flex-col items-center px-2">{inner}</span>
              )}
            </li>
          );
        })}
      </ol>
      {/* the line — under the numbers, following the current step */}
      <div aria-hidden className="mx-[10%] mt-1 h-[3px] overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500 transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${Math.max(6, progress)}%` }}
        />
      </div>
    </nav>
  );
}
