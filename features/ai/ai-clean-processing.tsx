"use client";

import { Check, CircleCheck, Cloud, Crown, ListChecks, Sparkles, Wand2, X } from "lucide-react";

import { FrenzAIWorkScene } from "@/features/ai/core/frenz-ai-work-scene";
import { AI_CLEAN_PATH, pathState, type StageView } from "@/lib/ai/job-stages";
import { cn } from "@/lib/utils";

/**
 * What a member watches while their video is being cleaned.
 *
 * Rebuilt from `public/ai progress.jpg` (owner, 2026-09-08): the work scene, a
 * headline, a five-step tracker with a real bar, a Pro tip, and Cancel.
 *
 * ── 🔴 NO INVENTED PERCENTAGE, AND NO INVENTED STAGE ─────────────────────────
 *
 * The bar moves when the job's real state changes, and during the upload it
 * follows bytes the browser has actually sent. It never creeps on a timer to
 * look busy. The steps are the JOURNEY, always all visible, and the ones we
 * cannot individually observe are never announced as the current one — see
 * lib/ai/job-stages.ts for exactly which and why.
 *
 * The honest cost: while the model runs, two steps light up together rather
 * than one after another. A member sees where they are; nobody is told a thing
 * we do not know. The reference shows a single active step and a precise 68%,
 * and that is the one place this deliberately departs from the drawing —
 * inventing a number would be the fabrication the whole design avoids.
 *
 * ── 🔴 AND IT SAYS HOW LONG, BECAUSE IT IS LONG ─────────────────────────────
 *
 * Measured 2026-09-08: a 0.15 MB clip ran over ten minutes. The model is
 * published on CPU hardware and no code here can change that — only a GPU
 * redeploy can (docs/replicate-gpu/). What this screen owes the member is the
 * truth about the wait and permission to leave, and both are below the tracker.
 *
 * ── Motion ───────────────────────────────────────────────────────────────────
 *
 * The scene, a width transition on the bar, and a pulse on the active step.
 * Nothing else. This screen can be open for ten minutes on a phone.
 */

/** The icon for each step of the path, in the reference's order. */
const STEP_ICON: Record<string, typeof Cloud> = {
  uploading: Cloud,
  queued: ListChecks,
  analyzing: Sparkles,
  removing: Wand2,
  finalizing: CircleCheck,
};

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

  /*
    The reference shows five steps. `AI_CLEAN_PATH` carries a sixth, `ready`,
    which is the finished STATE rather than a step somebody waits through — the
    result screen is what announces it, so it is not drawn here.
  */
  const tracked = AI_CLEAN_PATH.filter((s) => s.key !== "ready");

  return (
    <div className="p-4 sm:p-6">
      <div className="mx-auto max-w-xl">
        <FrenzAIWorkScene />

        <div className="mt-1 text-center">
          <h2 className="text-[1.6rem] font-bold leading-tight tracking-[-0.03em] sm:text-[1.8rem]">
            {view.label}
          </h2>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
            {view.detail ?? "AI is working its magic. Your clean video will be ready shortly."}
          </p>
          {fileName ? (
            <p className="mt-1.5 truncate text-xs text-muted-foreground/80" title={fileName}>
              {fileName}
            </p>
          ) : null}
        </div>

        {/* ── the tracker card ──────────────────────────────────────────── */}
        <div className="mt-5 rounded-[1.5rem] border border-border/60 bg-card/80 p-4 shadow-[0_18px_40px_-30px_hsl(229_55%_3%/0.5)] sm:p-5">
          <ol className="flex items-start justify-between gap-1">
            {tracked.map((step, i) => {
              const state = steps[step.key] ?? "todo";
              const Icon = STEP_ICON[step.key] ?? Sparkles;
              return (
                <li key={step.key} className="relative flex min-w-0 flex-1 flex-col items-center">
                  {/*
                    The connector, drawn from each step BACK to the previous one
                    so it can never dangle past the last item. It is behind the
                    circle and inset, which is why the circle needs its own
                    background rather than being transparent.
                  */}
                  {i > 0 ? (
                    <span
                      aria-hidden
                      className={cn(
                        "absolute right-1/2 top-5 h-px w-[calc(100%-1.75rem)] translate-x-[-0.875rem]",
                        state === "todo" ? "bg-border" : "bg-primary/40",
                      )}
                    />
                  ) : null}

                  <span
                    className={cn(
                      "relative z-[1] flex h-10 w-10 items-center justify-center rounded-full ring-1 transition-colors",
                      state === "done" && "bg-primary/12 text-primary ring-primary/30",
                      state === "doing" &&
                        "bg-gradient-to-br from-blue-500 to-violet-600 text-white ring-violet-400/50 shadow-[0_0_0_4px_rgb(139_92_246/0.18)]",
                      state === "todo" && "bg-secondary text-muted-foreground ring-border",
                    )}
                  >
                    <Icon className="h-[18px] w-[18px]" aria-hidden />
                  </span>

                  <span
                    className={cn(
                      "mt-2 text-center text-[10.5px] leading-tight",
                      state === "todo" ? "text-muted-foreground" : "font-semibold",
                    )}
                  >
                    {step.label}
                  </span>

                  {/* The reference puts a tick under each completed step. */}
                  <span className="mt-1 h-3.5">
                    {state === "done" ? (
                      <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>

          {/*
            One live region for the whole panel. Announcing each step separately
            would talk over somebody using a screen reader every few seconds;
            the heading changing is the news.
          */}
          <div
            role="status"
            aria-live="polite"
            className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-secondary"
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-600 via-blue-500 to-cyan-400 transition-[width] duration-500 ease-out motion-reduce:transition-none"
              style={{ width: `${Math.max(4, percent)}%` }}
            />
            <span className="sr-only">{view.label}</span>
          </div>

          <p className="mt-2.5 text-center text-xs text-muted-foreground">
            {view.label} <span className="font-bold text-foreground">{percent}%</span>
          </p>
        </div>

        {/* ── the Pro tip, as drawn ─────────────────────────────────────── */}
        <section className="relative mt-4 overflow-hidden rounded-[1.25rem] bg-[#0d1030] px-4 py-3.5 text-white ring-1 ring-inset ring-white/10">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(80% 120% at 92% 50%, rgba(217,70,239,0.45) 0%, transparent 62%)," +
                "radial-gradient(70% 110% at 70% 90%, rgba(56,189,248,0.35) 0%, transparent 60%)",
            }}
          />
          <div className="relative flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-amber-300 ring-1 ring-inset ring-white/15">
              <Crown className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-bold">Pro Tip</p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-300">
                This AI removes text, logos and watermarks for a clean, professional look.
              </p>
            </div>
          </div>
        </section>

        {/*
          🔴 The permission to leave, stated plainly. On CPU hardware this runs
          for minutes, and a member who believes they must watch will sit on a
          screen that cannot move faster for their attention. They get a push
          when it lands (lib/ai/notify.ts).
        */}
        <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
          This usually takes a few minutes. You can close this page — the work carries on and
          we&apos;ll notify you when it&apos;s ready.
        </p>

        {onCancel ? (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={onCancel}
              disabled={cancelling}
              className={cn(
                "inline-flex items-center gap-2 rounded-full px-7 py-3 text-sm font-semibold",
                "border border-rose-300/70 bg-rose-50 text-rose-600",
                "transition hover:bg-rose-100 active:scale-[0.99] disabled:opacity-60",
                "dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/15",
              )}
            >
              <X className="h-4 w-4" aria-hidden />
              {cancelling ? "Stopping…" : "Cancel"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
