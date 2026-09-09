"use client";

import { ArrowLeft, ArrowRight, Link2 } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { AI_CLEAN_ERRORS, parseVideoUrl } from "@/lib/ai/clean-media";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * The second way in: a link instead of a file.
 *
 * ── 🔴 THIS PARSES A STRING. IT STILL DOES NOT FETCH ─────────────────────────
 *
 * Owner's brief, verbatim: "Do not implement URL downloading yet. Do not fetch
 * arbitrary URLs from the browser." Both halves matter, and the second is not a
 * scheduling note — a client-side request to a link somebody pasted is a request
 * made from THEIR address, with their cookies, to a host nobody has checked. The
 * only validation here is `new URL()` on a trimmed string, which is why this file
 * imports no network code at all.
 *
 * Whether a link points at a video, or at a source this product supports, is a
 * question only the server can answer — and as of Part 6 it does, through
 * `validateAiSourceUrl`'s allow-list and then our worker. None of that changes
 * this file: the browser still only ever runs `new URL()` on a trimmed string.
 *
 * ── The error is inline, not a takeover ───────────────────────────────────────
 *
 * A mistyped link is a typo, not a failure. Replacing the whole stage with a
 * full error screen would throw away what they typed and make a one-character
 * fix into a restart, so the message lands under the field, in an `aria-live`
 * region, with the value still there to correct.
 */
export function AICleanUrlInput({
  onSubmit,
  onCancel,
}: {
  /** Receives the normalised absolute URL — never the raw input. */
  onSubmit: (url: string) => void;
  onCancel: () => void;
}) {
  const fieldId = useId();
  const errorId = useId();
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const url = parseVideoUrl(value);
    if (!url) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    haptic("selection");
    onSubmit(url);
  };

  return (
    <div className="p-4 sm:p-6">
      <div className="mx-auto max-w-xl py-4 sm:py-8">
        <div className="mb-5 text-center">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
            <Link2 className="h-5 w-5" aria-hidden />
          </span>
          <h2 className="mt-3 text-lg font-bold tracking-[-0.01em]">Paste video link</h2>
        </div>

        <form onSubmit={submit} noValidate>
          <label htmlFor={fieldId} className="sr-only">
            Video link
          </label>
          <input
            id={fieldId}
            type="url"
            inputMode="url"
            enterKeyHint="go"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="Paste a video link…"
            value={value}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            onChange={(e) => {
              setValue(e.target.value);
              if (invalid) setInvalid(false);
            }}
            className={cn(
              "h-14 w-full rounded-2xl border bg-background px-4 text-base outline-none transition",
              // 16px minimum on the font size, or iOS Safari zooms the whole
              // viewport when the field takes focus.
              "placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-ring",
              invalid ? "border-rose-500/60" : "border-input",
            )}
          />

          <p aria-live="polite" id={errorId} className="min-h-[1.25rem] px-1 pt-2 text-xs text-rose-600 dark:text-rose-400">
            {invalid ? AI_CLEAN_ERRORS["invalid-url"].body : ""}
          </p>

          <button type="submit" className="btn-lux btn-lux-primary mt-3 w-full">
            Continue
            <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        </form>

        <p className="mt-3 text-center text-xs leading-relaxed text-muted-foreground">
          Use a supported video source. We fetch it on our servers — nothing downloads to your device.
        </p>

        <div className="mt-5 text-center">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 text-sm font-semibold text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Choose a video instead
          </button>
        </div>
      </div>
    </div>
  );
}
