"use client";

import { AlertTriangle } from "lucide-react";

import { AI_CLEAN_ERRORS, type AICleanErrorCode } from "@/lib/ai/clean-media";

/**
 * Every dead end AI Clean can reach, drawn the same way.
 *
 * ── One shape, one way out ────────────────────────────────────────────────────
 * Title, one sentence, one button. The copy comes from `AI_CLEAN_ERRORS` rather
 * than from here, so the words a person reads live beside the rule that produces
 * them and a new failure cannot ship without its sentence.
 *
 * `role="alert"` because this replaces the stage the person was just looking at:
 * a screen-reader user has to be told the panel changed, not discover it by
 * tabbing into a different set of controls.
 *
 * The tone is amber, not red. Nothing has been lost or broken here — the file
 * simply cannot be used — and a destructive colour for a recoverable choice is
 * how an interface teaches people to fear it.
 */
export function AICleanErrorState({ code, onRetry }: { code: AICleanErrorCode; onRetry: () => void }) {
  const copy = AI_CLEAN_ERRORS[code];

  return (
    <div className="p-4 sm:p-6">
      <div role="alert" className="mx-auto max-w-md px-2 py-10 text-center sm:py-14">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-6 w-6" aria-hidden />
        </span>

        <h2 className="mt-4 text-lg font-bold tracking-[-0.01em]">{copy.title}</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{copy.body}</p>

        <button type="button" onClick={onRetry} className="btn-lux btn-lux-primary mt-6">
          {copy.action}
        </button>
      </div>
    </div>
  );
}
