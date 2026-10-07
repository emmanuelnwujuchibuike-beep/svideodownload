"use client";

import { Check, Crown, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { aiButtonClass } from "@/features/ai/design/ai-button";
import { PLAN_SURVEY_COMMENT_MAX, PLAN_SURVEY_GOALS, surveyFeaturesFor, type PlanFamily, type SurveyPlanId } from "@/lib/ai/credits/plan-survey";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  "WELCOME TO AI PRO" — the subscription celebration and its optional survey
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-10-07: "when they subscribe for pro, they should receive a
 * subscription celebration and an optional survey around the plans features."
 *
 * Every plan (owner, same day: "on all plans and not just AI plans"): the AI
 * plans on the credits page, the Frenzsave plans on the account page — when a
 * plan checkout returns activated, or when the welcome push
 * (lib/ai/credits/plan-welcome.ts) is opened (`?plan_welcome=1`). Each plan
 * shows its own benefits and asks about its own features. The survey is optional in every part — Skip closes the
 * sheet — and asked once per plan per browser; the server keeps the first
 * answer per plan whatever the browser does.
 *
 * Weight: no animation library — one CSS keyframe that reduced motion turns
 * off — and the module is only loaded when there is something to celebrate
 * (next/dynamic in the credits page). Portalled to <body> (the fixed-overlay law).
 */
export interface PlanCelebrationProps {
  plan: SurveyPlanId;
  family: PlanFamily;
  planLabel: string;
  /** One line under the title — the plan's headline fact. */
  subtitle: string;
  /** What the plan includes, from the plan's own list (never written here). */
  benefits: readonly string[];
  onClose: () => void;
}

const SURVEY_DONE_KEY = (plan: string) => `frenz:plan-survey:${plan}`;

function surveyDone(plan: string): boolean {
  try {
    return localStorage.getItem(SURVEY_DONE_KEY(plan)) === "1";
  } catch {
    return false;
  }
}

function markSurveyDone(plan: string) {
  try {
    localStorage.setItem(SURVEY_DONE_KEY(plan), "1");
  } catch {
    /* private mode — the server still keeps only the first answer */
  }
}

export function PlanCelebration({ plan, family, planLabel, subtitle, benefits, onClose }: PlanCelebrationProps) {
  const [mounted, setMounted] = useState(false);
  const [askSurvey, setAskSurvey] = useState(false);
  const [features, setFeatures] = useState<string[]>([]);
  const [goal, setGoal] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "thanks" | "error">("idle");

  useEffect(() => {
    setMounted(true);
    setAskSurvey(!surveyDone(plan));
    haptic("strong");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [plan, onClose]);

  const answered = features.length > 0 || !!goal || comment.trim().length > 0;

  async function submit() {
    if (!answered || state === "sending") return;
    setState("sending");
    try {
      const res = await fetch("/api/ai/subscriptions/survey", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ family, features, goal, comment }),
      });
      if (!res.ok) throw new Error(String(res.status));
      markSurveyDone(plan);
      haptic("medium");
      setState("thanks");
    } catch {
      setState("error");
    }
  }

  function skip() {
    markSurveyDone(plan);
    onClose();
  }

  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/45 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="plan-celebration-title" onClick={onClose}>
      <div
        className="plan-celebration relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-background p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted">
          <X className="h-4 w-4" aria-hidden />
        </button>

        <div className="flex flex-col items-center pt-2 text-center">
          <div className="plan-celebration__badge grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-lg">
            <Crown className="h-8 w-8" aria-hidden />
          </div>
          <p className="mt-3 text-[13px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-300">🎉 You&apos;re in</p>
          <h2 id="plan-celebration-title" className="mt-1 text-[22px] font-bold leading-tight">
            Welcome to {planLabel}
          </h2>
          <p className="mt-1.5 text-[14px] text-muted-foreground">{subtitle}</p>
        </div>

        <ul className="mt-4 space-y-2 rounded-2xl bg-muted/50 p-3.5 text-[13.5px]">
          {benefits.map((line) => (
            <li key={line} className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
              {line}
            </li>
          ))}
        </ul>

        {askSurvey && state !== "thanks" ? (
          <section className="mt-5" aria-labelledby="plan-survey-title">
            <h3 id="plan-survey-title" className="text-[15px] font-semibold">
              Help shape {planLabel} <span className="font-normal text-muted-foreground">(optional)</span>
            </h3>
            <p className="mt-0.5 text-[13px] text-muted-foreground">Which features did you subscribe for?</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {surveyFeaturesFor(family).map((f) => {
                const on = features.includes(f.id);
                return (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setFeatures((cur) => (on ? cur.filter((x) => x !== f.id) : [...cur, f.id]))}
                    className={cn(
                      "rounded-full px-3 py-1.5 text-[13px] ring-1 ring-inset transition-colors",
                      on ? "bg-violet-600 text-white ring-violet-600" : "bg-background text-foreground ring-border hover:bg-muted",
                    )}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>

            <p className="mt-4 text-[13px] text-muted-foreground">What will you mostly use it for?</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {PLAN_SURVEY_GOALS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  aria-pressed={goal === g.id}
                  onClick={() => setGoal((cur) => (cur === g.id ? null : g.id))}
                  className={cn(
                    "rounded-xl px-3 py-2 text-left text-[13px] ring-1 ring-inset transition-colors",
                    goal === g.id ? "bg-violet-50 text-violet-800 ring-violet-500 dark:bg-violet-500/15 dark:text-violet-200" : "ring-border hover:bg-muted",
                  )}
                >
                  {g.label}
                </button>
              ))}
            </div>

            <label className="mt-4 block text-[13px] text-muted-foreground" htmlFor="plan-survey-comment">
              Anything you&apos;d like us to add?
            </label>
            <textarea
              id="plan-survey-comment"
              value={comment}
              maxLength={PLAN_SURVEY_COMMENT_MAX}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              className="mt-1.5 w-full resize-none rounded-xl bg-background px-3 py-2 text-[14px] ring-1 ring-inset ring-border focus:outline-none focus:ring-2 focus:ring-violet-500"
              placeholder="Optional"
            />
            {state === "error" ? <p className="mt-2 text-[12.5px] text-red-600">Couldn&apos;t send that — try again, or skip.</p> : null}

            <div className="mt-4 flex gap-2">
              <button type="button" onClick={skip} className={aiButtonClass({ variant: "secondary", block: true })}>
                Skip
              </button>
              <button type="button" onClick={() => void submit()} disabled={!answered || state === "sending"} className={aiButtonClass({ block: true })}>
                {state === "sending" ? "Sending…" : "Send"}
              </button>
            </div>
          </section>
        ) : (
          <div className="mt-5">
            {state === "thanks" ? <p className="mb-3 text-center text-[13.5px] text-muted-foreground">Thank you — that helps us shape {planLabel}.</p> : null}
            <button type="button" onClick={onClose} className={aiButtonClass({ block: true })}>
              Start creating
            </button>
          </div>
        )}
      </div>
      <style>{`
        .plan-celebration{animation:plan-celebration-in .38s cubic-bezier(.2,.9,.3,1.15) both}
        .plan-celebration__badge{animation:plan-celebration-pop .6s cubic-bezier(.2,.9,.3,1.4) .12s both}
        @keyframes plan-celebration-in{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}
        @keyframes plan-celebration-pop{from{transform:scale(.6) rotate(-8deg);opacity:0}to{transform:none;opacity:1}}
        @media (prefers-reduced-motion: reduce){.plan-celebration,.plan-celebration__badge{animation:none}}
        :root[data-a11y-motion="reduce"] .plan-celebration,:root[data-a11y-motion="reduce"] .plan-celebration__badge{animation:none}
      `}</style>
    </div>,
    document.body,
  );
}
