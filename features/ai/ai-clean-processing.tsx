"use client";

import { Check, X } from "lucide-react";
import { useState } from "react";

import { aiCleanPath, pathState, type StageView } from "@/lib/ai/job-stages";
import type { AiSourceKind } from "@/lib/ai/jobs";
import { cn } from "@/lib/utils";

/**
 * What a member watches while their video is being cleaned.
 *
 * ── 🔴 REBUILT 2026-09-09 ───────────────────────────────────────────────────
 *
 * Owner: "the steps description looks too bold and cluster, it looks
 * unprofessional, I need a modern UI design that fits Adobe and top class AI
 * app system. And also the top loading animation is unnecessary, redesign the
 * whole page and restructure it."
 *
 * What was wrong, concretely:
 *
 *   · an illustrated scene took the top third of the screen and said nothing —
 *     on a ten-minute wait it is decoration in the most expensive position;
 *   · five steps across a phone gave each ~64px, so "Analyzing video" and
 *     "Removing text" wrapped to two lines and the row read as a wall;
 *   · every label was semibold, every active circle was a 40px gradient disc
 *     with a 4px glow ring, and a tick row sat underneath. Four competing
 *     emphases in one card;
 *   · the dark "Pro Tip" panel introduced a fifth colour temperature.
 *
 * ── The restructure ─────────────────────────────────────────────────────────
 *
 * Reading order is now: what is happening → how far → what is left → the way
 * out. One accent colour, one bold element (the percentage), and the step list
 * runs VERTICALLY, which is what removes the wrapping and the crowding at a
 * stroke. Serious tools state progress; they do not perform it.
 *
 * ── 🔴 STILL NO INVENTED PERCENTAGE, AND NO INVENTED STAGE ──────────────────
 *
 * Unchanged, and load-bearing. The bar moves when the job's real state changes
 * and follows real bytes during the upload. Steps we cannot individually
 * observe are never announced as the current one, so while the model runs two
 * rows are active together rather than one marching after the other. A member
 * sees where they are; nobody is told a thing we do not know.
 *
 * ── Motion ──────────────────────────────────────────────────────────────────
 *
 * A width transition on the bar and one soft pulse on active rows. Nothing
 * else, and both stop under `prefers-reduced-motion`. This screen can be open
 * for ten minutes on a phone in somebody's hand.
 */
export function AICleanProcessing({
  view,
  fileName,
  sourceKind = "upload",
  onCancel,
  cancelling,
}: {
  view: StageView;
  fileName: string | null;
  /** Part 6: a link says "Getting your video" where a file says "Uploading". */
  sourceKind?: AiSourceKind;
  onCancel?: () => void;
  cancelling?: boolean;
}) {
  const steps = pathState(view.stage);
  const percent = view.progress === null ? 0 : Math.round(view.progress * 100);

  /** The second step of Cancel. See the note above the button for why it exists. */
  const [confirming, setConfirming] = useState(false);

  /*
    `ready` is the finished STATE, not a step somebody waits through — the
    result screen announces it, so it is not a row here.
  */
  const tracked = aiCleanPath(sourceKind).filter((s) => s.key !== "ready");

  return (
    <div className="p-5 sm:p-7">
      <div className="mx-auto max-w-md">
        {/* ── what is happening ─────────────────────────────────────────── */}
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="min-w-0 text-[1.35rem] font-semibold leading-tight tracking-[-0.02em] sm:text-[1.5rem]">
            {view.label}
          </h2>
          {/*
            🔴 The one bold thing on the screen. When everything is emphasised
            nothing is, which is exactly what made the old card read as noise.
            `tabular-nums` so the number does not jitter as it counts.
          */}
          <span className="shrink-0 text-[1.35rem] font-semibold tabular-nums text-primary sm:text-[1.5rem]">
            {percent}%
          </span>
        </div>

        <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
          {view.detail ?? "Frenz AI is working on your video."}
        </p>

        {fileName ? (
          <p className="mt-1 truncate text-xs text-muted-foreground/70" title={fileName}>
            {fileName}
          </p>
        ) : null}

        {/* ── how far ───────────────────────────────────────────────────── */}
        <div
          role="status"
          aria-live="polite"
          className="mt-5 h-1 w-full overflow-hidden rounded-full bg-border/70"
        >
          {/*
            1px, not 10. A hairline reads as a measurement; a thick gradient bar
            reads as a loading toy. The gradient is kept but restrained to the
            brand's blue→violet, dropping the cyan that made three hues compete.
          */}
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-600 to-violet-600 transition-[width] duration-700 ease-out motion-reduce:transition-none"
            style={{ width: `${Math.max(3, percent)}%` }}
          />
          <span className="sr-only">{view.label}</span>
        </div>

        {/* ── what is left ──────────────────────────────────────────────── */}
        {/*
          🔴 VERTICAL. Five labels across a 390px phone is ~64px each, which is
          why two of them wrapped and the whole row read as clutter. Down the
          page each row gets the full width, the text sits on one line at a
          readable size, and the eye follows a single column.
        */}
        <ol className="mt-6 flex flex-col">
          {tracked.map((step, i) => {
            const state = steps[step.key] ?? "todo";
            const last = i === tracked.length - 1;
            return (
              <li key={step.key} className="relative flex items-center gap-3 pb-4 last:pb-0">
                {/*
                  The rail, drawn from this row's marker down to the next. Behind
                  the marker and inset so it never pokes out of the last item.
                */}
                {!last ? (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute left-[9px] top-[18px] h-[calc(100%-10px)] w-px",
                      state === "done" ? "bg-primary/30" : "bg-border",
                    )}
                  />
                ) : null}

                {/*
                  A 18px marker instead of a 40px gradient disc with a glow. Done
                  is a quiet filled tick, active is a small solid dot with one
                  soft pulse, and to-come is an outline. Three states, read at a
                  glance, none of them shouting.
                */}
                <span
                  className={cn(
                    "relative z-[1] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full",
                    state === "done" && "bg-primary text-white",
                    state === "doing" && "bg-primary text-white",
                    state === "todo" && "border border-border bg-background",
                  )}
                >
                  {state === "done" ? (
                    <Check className="h-[11px] w-[11px]" strokeWidth={3} aria-hidden />
                  ) : state === "doing" ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-white motion-safe:animate-pulse" aria-hidden />
                  ) : null}
                </span>

                <span
                  className={cn(
                    "text-[13.5px] leading-none",
                    state === "todo" && "text-muted-foreground/70",
                    state === "done" && "text-muted-foreground",
                    // Only the CURRENT work is emphasised, and only in weight.
                    state === "doing" && "font-medium text-foreground",
                  )}
                >
                  {step.label}
                </span>
              </li>
            );
          })}
        </ol>

        {/*
          ── The way out ───────────────────────────────────────────────────

          🔴 The permission to leave, stated plainly and WITHOUT naming the
          hardware. It used to say "on CPU hardware this runs for minutes",
          which is an implementation detail on a member's screen and reads as an
          apology (owner, 2026-09-09). They get a push when it lands.
        */}
        <p className="mt-6 text-[12.5px] leading-relaxed text-muted-foreground">
          You can close this page — the work carries on and we&apos;ll notify you when it&apos;s ready.
        </p>

        {/*
          ── 🔴 CANCELLING IS NOT FREE, SO IT ASKS TWICE ────────────────────

          Owner, 2026-09-09: "put a two step are you sure, cancelling starts the
          process again and may consume your credit. When a user want to cancel
          an AI video, then tell them they can go to next page and it continues
          without clicking the cancel button."

          Both halves matter and they are different facts:

          1. STOPPING COSTS. The slot is refunded on cancel, so nothing is
             stolen — but starting over spends one of the day's videos again,
             and the minutes already waited are gone. Somebody tapping Cancel
             out of impatience is usually about to pay for that impatience
             twice, and this is the moment to say so.

          2. THEY PROBABLY WANT THE OTHER THING. Almost every cancel on a
             long-running job is really "I need to go" — and leaving is already
             free: the work runs on our machines, not in this tab, and a push
             arrives when it lands. The dialogue offers that first, because it
             is what most people actually mean.

          A plain `window.confirm` would have done the job and is rejected on
          purpose: it cannot say two things, it cannot be styled, and on iOS it
          steals focus in a way that has broken sheets in this app before.
        */}
        {onCancel ? (
          <div className="mt-5">
            {confirming ? (
              <div
                role="alertdialog"
                aria-labelledby="ai-cancel-title"
                aria-describedby="ai-cancel-body"
                className="rounded-2xl border border-border/70 bg-card/95 p-4"
              >
                <p id="ai-cancel-title" className="text-[13.5px] font-semibold">
                  Stop cleaning this video?
                </p>
                <p id="ai-cancel-body" className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
                  You don&apos;t have to stop it to leave — close this page and the work carries on,
                  and we&apos;ll notify you when it&apos;s ready. If you stop now, starting again
                  uses another of your daily videos.
                </p>

                <div className="mt-3.5 flex flex-col gap-2 sm:flex-row-reverse">
                  {/*
                    🔴 "Keep cleaning" is the primary and it is FIRST in the
                    reversed row, so on a phone the safe choice sits under the
                    thumb and the destructive one is a deliberate reach.
                  */}
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    className="inline-flex flex-1 items-center justify-center rounded-full bg-foreground px-5 py-2.5 text-[13px] font-semibold text-background transition active:scale-[0.99]"
                  >
                    Keep cleaning
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirming(false);
                      onCancel();
                    }}
                    disabled={cancelling}
                    className={cn(
                      "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-medium",
                      "text-rose-600 transition hover:bg-rose-50 active:scale-[0.99]",
                      "disabled:opacity-60 dark:text-rose-400 dark:hover:bg-rose-500/10",
                    )}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                    {cancelling ? "Stopping…" : "Stop anyway"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={cancelling}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium",
                  "text-muted-foreground transition hover:text-rose-600 active:scale-[0.99]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "disabled:opacity-60 dark:hover:text-rose-400",
                )}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
                {cancelling ? "Stopping…" : "Cancel"}
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
