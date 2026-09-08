"use client";

import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { AI_CLEAN_TUTORIAL_STEPS, AICleanTutorialStep } from "@/features/ai/ai-clean-tutorial-step";
import { Portal } from "@/components/ui/portal";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  AI CLEAN — the first-visit tutorial
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A sheet on a phone, a dialog on a desktop, the same four steps in both. It is
 * lazily imported by the workspace, so a returning member — who will never see
 * it again — never downloads it.
 *
 * ── The accessibility here is the feature, not a checklist ────────────────────
 *
 * This is the one surface in Frenz AI that opens BY ITSELF, over what someone
 * came to do. Everything below follows from that:
 *
 *   • Escape closes it, and closing it counts as skipping — a dialog you cannot
 *     dismiss with the key everyone reaches for is a trap, whatever it stores.
 *   • Focus enters the panel on open and RETURNS to whatever opened it on close,
 *     so a keyboard user is not dropped at the top of the document.
 *   • Tab cycles inside the panel. Unlike the app's shared sheet shell — which is
 *     honest about only implementing half the dialog pattern — this one traps,
 *     because the page behind it is a file picker: tabbing into it blind and
 *     opening a native dialog underneath an open tutorial is a genuinely stuck
 *     state.
 *   • ←/→ move between steps, so the whole thing is operable without reaching
 *     for a button.
 *   • The step counter is announced politely on change; focus stays on Next so
 *     Enter walks the whole tutorial.
 *
 * ── Motion ───────────────────────────────────────────────────────────────────
 *
 * One entrance (a short rise and fade), one exit, and a crossfade between steps.
 * No spring, no stagger, no travelling gradient. `motion-reduce:` removes every
 * one of them and `prefersReducedMotion` also drops the exit DELAY, so a
 * reduced-motion viewer's dismiss is instant rather than merely un-animated.
 */

/** Matches `--dur-fast` (160ms) — the exit has to finish before the unmount. */
const EXIT_MS = 160;

export type AICleanTutorialOutcome = "skipped" | "completed";

export function AICleanTutorial({
  open,
  onClose,
}: {
  open: boolean;
  /** `skipped` for a dismiss at any step, `completed` for Get Started. */
  onClose: (outcome: AICleanTutorialOutcome) => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const exitTimer = useRef<number | null>(null);

  const [index, setIndex] = useState(0);
  /** Drives the entrance/exit transition — false for one frame on mount. */
  const [shown, setShown] = useState(false);

  const step = AI_CLEAN_TUTORIAL_STEPS[index] ?? AI_CLEAN_TUTORIAL_STEPS[0]!;
  const last = index === AI_CLEAN_TUTORIAL_STEPS.length - 1;

  const finish = useCallback(
    (outcome: AICleanTutorialOutcome) => {
      const reduced =
        typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      setShown(false);
      if (reduced) {
        onClose(outcome);
        return;
      }
      exitTimer.current = window.setTimeout(() => onClose(outcome), EXIT_MS);
    },
    [onClose],
  );

  // Open: remember the opener, start at step one, lock the page, take focus.
  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setIndex(0);
    const raf = requestAnimationFrame(() => setShown(true));
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => panelRef.current?.focus(), 50);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      if (exitTimer.current) window.clearTimeout(exitTimer.current);
      // Hand focus back to whatever opened it — the replay button, or the page.
      openerRef.current?.focus?.();
    };
  }, [open]);

  const next = useCallback(() => {
    haptic("light");
    if (last) {
      finish("completed");
      return;
    }
    setIndex((i) => Math.min(AI_CLEAN_TUTORIAL_STEPS.length - 1, i + 1));
  }, [finish, last]);

  const back = useCallback(() => {
    haptic("light");
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  // Keyboard: Escape dismisses, arrows step, Tab is trapped inside the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish("skipped");
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        back();
        return;
      }
      if (e.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      );
      const first = focusables[0];
      const lastEl = focusables[focusables.length - 1];
      if (!first || !lastEl) return;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, finish, next, back]);

  if (!open) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-[120] flex items-end justify-center sm:items-center sm:p-6">
        <button
          type="button"
          aria-label="Close tutorial"
          onClick={() => finish("skipped")}
          className={cn(
            "absolute inset-0 bg-black/50 transition-opacity duration-200 motion-reduce:transition-none",
            shown ? "opacity-100" : "opacity-0",
          )}
        />

        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          tabIndex={-1}
          className={cn(
            "relative flex w-full max-w-lg flex-col rounded-t-3xl border border-border/60 bg-card shadow-elevated outline-none sm:rounded-3xl",
            "transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
            // Bottom sheet on a phone, centred card from ~640px up.
            shown ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0 sm:translate-y-2",
          )}
        >
          <div className="flex items-start justify-between gap-3 px-5 pt-5 sm:px-7 sm:pt-6">
            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">Frenz AI</span>
            <button
              type="button"
              onClick={() => finish("skipped")}
              aria-label="Close tutorial"
              className="-mr-1.5 -mt-1.5 rounded-full p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>

          <div className="px-5 pb-1 pt-3 sm:px-7">
            {/* Keyed on the step so the crossfade replays — the content swaps in
                place, which is what keeps the sheet from resizing under a finger. */}
            <div key={step.id} className="motion-safe:animate-fade-up">
              <AICleanTutorialStep step={step} titleId={titleId} descriptionId={descriptionId} />
            </div>
            <p aria-live="polite" className="sr-only">
              Step {index + 1} of {AI_CLEAN_TUTORIAL_STEPS.length}
            </p>
          </div>

          {/*
            Progress, as four equal bars that only change COLOUR.

            The obvious version — a dot that grows into a pill for the active
            step — animates `width`, and this project's performance rule is that
            only `transform` and `opacity` may be animated: a width transition is
            layout on every frame it runs. Four bars carry the same information,
            and they carry a little more of it, since a completed step can be
            tinted differently from one not reached yet.
          */}
          <div className="flex items-center justify-center gap-1.5 px-5 py-4" aria-hidden>
            {AI_CLEAN_TUTORIAL_STEPS.map((s, i) => (
              <span
                key={s.id}
                className={cn(
                  "h-1.5 w-6 rounded-full transition-colors duration-200 motion-reduce:transition-none",
                  i === index ? "bg-primary" : i < index ? "bg-primary/35" : "bg-border",
                )}
              />
            ))}
          </div>

          <div className="flex items-center gap-2 border-t border-border/60 px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4 sm:px-7 sm:pb-5">
            {index === 0 ? (
              <button
                type="button"
                onClick={() => finish("skipped")}
                className="min-h-[44px] rounded-full px-3 text-sm font-semibold text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Skip
              </button>
            ) : (
              <button type="button" onClick={back} className="btn-lux btn-lux-secondary">
                <ArrowLeft className="h-4 w-4" aria-hidden />
                Back
              </button>
            )}

            <button type="button" onClick={next} className="btn-lux btn-lux-primary ml-auto min-w-[8.5rem]">
              {last ? "Get Started" : "Next"}
              {last ? null : <ArrowRight className="h-4 w-4" aria-hidden />}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

export default AICleanTutorial;
