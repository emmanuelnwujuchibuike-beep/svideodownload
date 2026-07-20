"use client";

import { ArrowRight, Check, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";


import { gradeAssessment, getAssessment, orderedQuestions } from "@/lib/academy/assessments";
import { getLessonMeta } from "@/lib/learning/catalog";
import { cn } from "@/lib/utils";

/**
 * "Check your understanding" — the self-check at the end of a course.
 *
 * ── This file is a LAZY CHUNK, and that is the point ──────────────────────────
 *
 * It is the only module on the school pages that imports the question corpus,
 * and it is loaded by `course-check.tsx` on demand — never during the initial
 * page load. That split is not tidiness, it is a measured 15 kB: with this
 * component imported eagerly, `/academy/[school]` went from 260 kB to 275 kB of
 * first-load JS, on a static content page, for a quiz most readers never open.
 *
 * So: nothing that renders before the reader clicks may import this file.
 * `academy-perf.test.ts` pins that, because the failure is silent — the page
 * still works perfectly, it is just heavier for everyone.
 *
 * ── Deliberately NOT wired into the personal plane ────────────────────────────
 *
 * Passing a check does not mark the course's lessons complete. Those are two
 * different facts — "I read this" and "I answered questions about it" — and
 * collapsing them would corrupt the input to `recommendNext`, which reads
 * completions to decide what to suggest next. Someone who guessed their way
 * through four questions would stop being recommended the lessons they never
 * opened. Nothing is stored at all: a result lives for as long as the reader is
 * looking at it, which is what a self-check is worth.
 *
 * ── Result state is per attempt, not per question ─────────────────────────────
 *
 * Grading happens once, on submit, rather than marking each answer as it is
 * picked. Immediate marking turns the check into a guessing game — you learn the
 * answer by trying options — and it removes the moment where the reader commits
 * to what they think, which is the only part that tests anything.
 */
export default function CourseCheckPanel({
  courseSlug,
  className,
}: {
  courseSlug: string;
  className?: string;
}) {
  const questions = useMemo(() => orderedQuestions(courseSlug), [courseSlug]);
  const assessment = useMemo(() => getAssessment(courseSlug), [courseSlug]);

  const [chosen, setChosen] = useState<Record<string, string | null>>({});
  const [result, setResult] = useState<ReturnType<typeof gradeAssessment>>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  /*
    The truth gate again, at the last possible moment. A school page could be
    rendered for a course whose assessment was withdrawn; rendering nothing is
    correct and silent, rather than an empty panel with a submit button.
  */
  if (!assessment || questions.length === 0) return null;

  const answeredCount = questions.filter((q) => chosen[q.id]).length;

  function submit() {
    const graded = gradeAssessment(courseSlug, chosen);
    setResult(graded);
    // Move focus to the outcome rather than leaving it on a button that has
    // just changed meaning — otherwise a screen reader is told nothing happened.
    requestAnimationFrame(() => resultRef.current?.focus());
  }

  function reset() {
    setChosen({});
    setResult(null);
  }

  return (
    <section
      aria-label={assessment.title}
      className={cn("mt-6 rounded-2xl border border-border/70 bg-card p-5 sm:p-6", className)}
    >
      <header className="mb-5">
        <h4 className="text-base font-semibold tracking-[-0.01em]">Check your understanding</h4>
        <p className="mt-1 text-sm text-muted-foreground">
          {/*
            Said plainly, once, where it is relevant. The reader is entitled to
            know this is not being recorded or marked by anyone before they
            answer — and knowing it is what makes the exercise useful rather
            than stressful.
          */}
          Nothing is saved or scored against you. This is a way to find out whether the course
          landed.
        </p>
      </header>

      {result && (
        <div
          ref={resultRef}
          tabIndex={-1}
          role="status"
          className="mb-6 rounded-xl border border-border/60 bg-background p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <p className="text-sm font-semibold">
            {result.score} of {result.total} correct
            {result.passed ? " — that is a solid pass." : ""}
          </p>
          {result.reviewLessonSlugs.length > 0 ? (
            <>
              {/* The review list is the product. It leads. */}
              <p className="mt-2 text-sm text-muted-foreground">Worth rereading:</p>
              <ul className="mt-2 space-y-1.5">
                {result.reviewLessonSlugs.map((slug) => {
                  const lesson = getLessonMeta(slug);
                  return (
                    <li key={slug}>
                      <Link
                        href={`/learn/${slug}`}
                        className="group inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        {lesson?.title ?? slug}
                        <ArrowRight
                          aria-hidden
                          className="h-3.5 w-3.5 transition group-hover:translate-x-0.5"
                        />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              Nothing to reread — you have this course.
            </p>
          )}
        </div>
      )}

      <ol className="space-y-6">
        {questions.map((question, index) => {
          const graded = result?.answers.find((a) => a.questionId === question.id);

          return (
            <li key={question.id}>
              <fieldset disabled={Boolean(result)}>
                <legend className="text-sm font-medium leading-relaxed">
                  <span aria-hidden className="mr-1.5 text-muted-foreground">
                    {index + 1}.
                  </span>
                  {question.prompt}
                </legend>

                <div className="mt-3 space-y-2">
                  {question.choices.map((choice) => {
                    const picked = chosen[question.id] === choice.id;
                    const isAnswer = choice.id === question.correctChoiceId;
                    /*
                      After grading, the correct choice is marked whether or not
                      the reader picked it. Showing only "you were wrong"
                      without showing what was right is the version of feedback
                      that teaches nothing.
                    */
                    const showAsCorrect = Boolean(result) && isAnswer;
                    const showAsWrong = Boolean(result) && picked && !isAnswer;

                    return (
                      <label
                        key={choice.id}
                        className={cn(
                          "flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm leading-relaxed transition",
                          "border-border/60 hover:border-primary/40",
                          picked && !result && "border-primary/60 bg-primary/5",
                          /*
                            Literal palette colours, not design tokens. There is
                            no `destructive` token in this project — the first
                            version of this used one and it emitted no CSS at
                            all, so wrong answers rendered identically to
                            untouched ones and only the icon distinguished them.
                            Typecheck, lint and tests all passed on that.
                          */
                          showAsCorrect && "border-emerald-500/60 bg-emerald-500/5",
                          showAsWrong && "border-rose-500/60 bg-rose-500/5",
                          result && "cursor-default",
                        )}
                      >
                        <input
                          type="radio"
                          name={question.id}
                          value={choice.id}
                          checked={picked}
                          onChange={() =>
                            setChosen((prev) => ({ ...prev, [question.id]: choice.id }))
                          }
                          className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                        />
                        <span className="min-w-0 flex-1">{choice.text}</span>
                        {showAsCorrect && (
                          <Check aria-label="Correct answer" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                        )}
                        {showAsWrong && (
                          <X aria-label="Your answer, incorrect" className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                        )}
                      </label>
                    );
                  })}
                </div>

                {graded && (
                  <p
                    className={cn(
                      "mt-3 rounded-lg border-l-2 py-1 pl-3 text-sm leading-relaxed text-muted-foreground",
                      graded.correct ? "border-emerald-500/60" : "border-rose-500/60",
                    )}
                  >
                    {question.explanation}
                  </p>
                )}
              </fieldset>
            </li>
          );
        })}
      </ol>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {result ? (
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-xl border border-border/70 px-4 py-2.5 text-sm font-medium transition hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <RotateCcw aria-hidden className="h-4 w-4" />
            Try again
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={submit}
              className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              Check answers
            </button>
            {/*
              A count, not a block. Submitting with questions unanswered is
              allowed on purpose — grading treats a skip as wrong and still
              returns every explanation, so a partial attempt is still worth
              something. Disabling the button would withhold that.
            */}
            <span className="text-xs text-muted-foreground">
              {answeredCount} of {questions.length} answered
            </span>
          </>
        )}
      </div>
    </section>
  );
}
