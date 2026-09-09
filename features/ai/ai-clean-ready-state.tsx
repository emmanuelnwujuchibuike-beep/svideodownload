"use client";

import { ArrowLeft, FileVideo, Link2, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { AICleanProBadge } from "@/features/ai/ai-clean-pro-badge";

/**
 * Where Continue goes — and the one screen in this feature that has to be most
 * careful about what it says.
 *
 * ── 🔴 IT DOES NOT PRETEND — AND WHAT THAT MEANS CHANGED IN PART 6 ───────────
 *
 * Part 1 shipped this as an honest dead end. The brief then was "no real AI
 * processing should happen yet", so the panel said the cleanup was not
 * connected, there was no bar, no percentage and no fake stage list, and the
 * Pro/free copy was written in the future tense because nothing had been spent.
 *
 * Part 6 connected it. The same rule now points the other way: a screen that
 * still said "nothing has been fetched" would be exactly the kind of stale
 * claim the original was written to avoid. So the panel states what is about to
 * happen, the button starts a real job, and the allowance sentence is present
 * tense because the allowance is now real and server-side.
 *
 * ── In practice this is the LINK screen ─────────────────────────────────────
 *
 * A file goes through `AICleanVideoPreview`, which has the frame, the metadata
 * and its own Continue. Only a pasted link lands here — the file branch is kept
 * because the shape costs nothing and a future entry point may want it.
 *
 * Nothing here decides anything. `onStart` calls the one state machine
 * (`useAiCleanJob.submit`), and every gate — the allowance, the ad, the URL
 * allow-list — is re-resolved server-side after that.
 */
export function AICleanReadyState({
  source,
  isPro,
  planKnown,
  onBack,
  onStart,
  busy = false,
}: {
  source: { kind: "file"; name: string } | { kind: "link"; url: string };
  isPro: boolean;
  /** False until `/api/me` has answered — see the note below. */
  planKnown: boolean;
  onBack: () => void;
  /** Start the job. Part 6: for a link this is what sends it to our worker. */
  onStart: () => void;
  /** True while the submission is in flight, so the button cannot double-fire. */
  busy?: boolean;
}) {
  const Icon = source.kind === "file" ? FileVideo : Link2;
  const label = source.kind === "file" ? source.name : source.url;

  return (
    <div className="p-4 sm:p-6">
      <div className="mx-auto max-w-xl py-2 sm:py-6">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold tracking-[-0.01em]">Ready to clean</h2>
          <AICleanProBadge />
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          This is the video AI Clean will work on.
        </p>

        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-border/70 bg-secondary/30 px-4 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
            <Icon className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium" title={label}>
            {label}
          </span>
        </div>

        {/*
          ── 🔴 THE LINK PATH IS REAL NOW (Part 6) ──────────────────────────

          This panel used to say "the cleanup itself isn't connected yet", which
          was the honest thing to render while Part 1 shipped an interface with
          nothing behind it. Our server fetches the video now, so that sentence
          would be the lie the original was written to avoid.

          What replaces it is a statement of what is about to happen, in the
          member's terms: OUR server does the fetching, not their browser and
          not their connection.
        */}
        <div className="mt-4 rounded-2xl border border-primary/25 bg-primary/[0.04] p-4">
          <p className="flex items-start gap-2 text-sm font-semibold">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            {source.kind === "file" ? "Ready when you are" : "We'll fetch this for you"}
          </p>
          <p className="mt-1.5 pl-6 text-sm leading-relaxed text-muted-foreground">
            {source.kind === "file"
              ? "Your video goes straight to private storage, and only Frenz AI reads it."
              : "Frenz AI downloads the video on our servers — nothing is sent from your device, and it keeps going if you close the app."}
          </p>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          {!planKnown
            ? "AI Clean is included with Pro."
            : isPro
              ? "Included with your Pro plan — no ads, no daily cap."
              : "Free members get 3 AI Clean videos a day, each unlocked by watching a short ad. Pro removes both."}
        </p>

        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row-reverse">
          <button
            type="button"
            onClick={onStart}
            disabled={busy}
            className={cn(
              "group inline-flex flex-1 items-center justify-center gap-2 rounded-full px-6 py-3.5",
              "bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500",
              "text-sm font-bold text-white shadow-[0_14px_34px_-12px_rgb(99_102_241/0.95)]",
              "transition duration-200 motion-safe:hover:-translate-y-0.5 active:scale-[0.99]",
              "disabled:opacity-70 disabled:hover:translate-y-0",
            )}
          >
            <Sparkles className="h-4 w-4" aria-hidden />
            {busy ? "Starting…" : "Clean this video"}
          </button>

          <button type="button" onClick={onBack} disabled={busy} className="btn-lux btn-lux-secondary disabled:opacity-70">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
