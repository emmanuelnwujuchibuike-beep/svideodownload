"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * THE FRENZ AI STEP RAIL — the numbered steps across the top of a multi-step
 * flow. Promoted from Character Replace's stepper (2026-10-08) so the
 * advertiser flow shows the SAME rail rather than a look-alike: one definition,
 * so a radius or a colour can only drift in one place.
 *
 * A finished step is a button that goes back to it (when `onGo` is given); the
 * current step carries `aria-current="step"`; a step not yet earned is static
 * text. The line under the labels is the only motion — it follows the current
 * step with a `transform` (no layout), and stops under reduced motion.
 *
 * At 360px five labels do not fit beside their numbers, so on a phone the
 * rail shows the numbers and ONE label (the current step's); from `sm` up
 * every label is printed. The numbers alone are enough to say "3 of 5".
 */
export interface AiStep<Id extends string = string> {
  id: Id;
  label: string;
}

export function AiStepRail<Id extends string>({
  steps,
  currentIndex,
  furthestIndex = currentIndex,
  onGo,
  className,
  label = "Steps",
}: {
  steps: readonly AiStep<Id>[];
  currentIndex: number;
  /** The furthest step the member may open. */
  furthestIndex?: number;
  onGo?: (step: Id) => void;
  className?: string;
  label?: string;
}) {
  const progress = steps.length > 1 ? currentIndex / (steps.length - 1) : 1;

  return (
    <nav aria-label={label} className={cn("relative", className)}>
      <ol className="flex items-start justify-between gap-1">
        {steps.map((step, i) => {
          const done = i < currentIndex;
          const active = i === currentIndex;
          const reachable = !!onGo && i <= furthestIndex && !active;
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
                  onClick={() => onGo!(step.id)}
                  className="flex min-h-[44px] flex-col items-center rounded-xl px-2 outline-none transition hover:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Back to ${step.label}`}
                >
                  {inner}
                </button>
              ) : (
                <span className="flex min-h-[44px] flex-col items-center px-2">
                  {inner}
                  {active ? <span className="sr-only">, step {i + 1} of {steps.length}</span> : null}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {/* the line — under the numbers, following the current step (transform only, no layout) */}
      <div aria-hidden className="mx-[10%] mt-1 h-[3px] overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full w-full origin-left rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500 transition-transform duration-500 ease-out motion-reduce:transition-none"
          style={{ transform: `scaleX(${Math.max(0.06, progress)})` }}
        />
      </div>
    </nav>
  );
}
