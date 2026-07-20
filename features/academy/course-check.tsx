"use client";

import { lazy, Suspense, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The "Check your understanding" disclosure — deliberately tiny.
 *
 * ── Why this is split from the panel ──────────────────────────────────────────
 *
 * The question corpus is prose, and it is only worth downloading if the reader
 * actually wants the check. The first version of this component imported the
 * corpus directly and, measured on the build, took `/academy/[school]` from
 * 260 kB to 275 kB of first-load JS. That is 15 kB shipped to everyone who
 * reads a school page, on a project whose first rule is a two-second cold entry,
 * for something most readers will scroll straight past.
 *
 * So this file holds the button and nothing else. `course-check-panel.tsx` holds
 * every question, every answer and every explanation, and it is fetched on the
 * click that opens it.
 *
 * ── The question COUNT comes from the server, not from the corpus ─────────────
 *
 * The button reads "4 questions", which is one number from a module worth 15 kB.
 * The school page is a server component, so it can call
 * `assessmentQuestionCount()` for free and pass the result as a prop. Importing
 * the corpus here to count its own length would reintroduce the whole cost to
 * save a prop — which is precisely how the original regression happened.
 *
 * ── `next/dynamic` with `ssr: false` is NOT used here ─────────────────────────
 *
 * It has never resolved correctly in this app. `React.lazy` behind a click is
 * doing the same job with no framework-specific behaviour to go wrong: the
 * import cannot run until `open` is true, so there is nothing to resolve during
 * hydration in the first place.
 */
const CourseCheckPanel = lazy(() => import("./course-check-panel"));

export function CourseCheck({
  courseSlug,
  questionCount,
  className,
}: {
  courseSlug: string;
  /** From `assessmentQuestionCount()` on the server. 0 means no check exists. */
  questionCount: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  // No check written for this course. Renders nothing, so the school page needs
  // no conditional of its own.
  if (questionCount <= 0) return null;

  if (!open) {
    return (
      <div className={cn("mt-6", className)}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-xl border border-border/70 bg-card px-4 py-2.5 text-sm font-medium transition hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          Check your understanding
          <span className="text-xs font-normal text-muted-foreground">
            {questionCount} questions
          </span>
        </button>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        /*
          Reserves roughly the height the panel will occupy. The chunk is small
          and usually arrives within a frame, but on a slow connection an
          unreserved swap would shove the next course down the page just as the
          reader looks at it.
        */
        <div
          className={cn(
            "mt-6 min-h-[18rem] animate-pulse rounded-2xl border border-border/70 bg-card",
            className,
          )}
          aria-hidden
        />
      }
    >
      <CourseCheckPanel courseSlug={courseSlug} className={className} />
    </Suspense>
  );
}
