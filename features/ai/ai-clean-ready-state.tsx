"use client";

import { ArrowLeft, FileVideo, Link2, Sparkles } from "lucide-react";

import { AICleanProBadge } from "@/features/ai/ai-clean-pro-badge";

/**
 * Where Continue goes — and the one screen in this feature that has to be most
 * careful about what it says.
 *
 * ── 🔴 IT DOES NOT PRETEND ────────────────────────────────────────────────────
 *
 * Owner's brief: "The Continue button can transition to a placeholder
 * processing/options state for UI testing, but no real AI processing should
 * happen yet." The tempting build is a progress bar that fills on a timer and a
 * "Done!" at the end. That is a lie with an animation on it, and this project has
 * declined to fabricate a number three times already. So there is no bar, no
 * percentage, no fake stage list, and no result to download — just the video that
 * was chosen, and a plain sentence about what happens next.
 *
 * ── The Pro/free block is a SLOT, not a meter ─────────────────────────────────
 *
 * The brief describes what free members will get when processing lands: three
 * runs a day, behind a rewarded ad. Every word of that here is future tense and
 * NOTHING is counted. A "2 of 3 left today" read from the browser would be both
 * fake (nothing has been spent) and forgeable (a counter a visitor can edit is
 * not a limit) — the real allowance is already metered server-side in Redis for
 * the media tools (lib/ai/quota.ts), and AI Clean will be charged the same way.
 *
 * What this component genuinely provides is the LAYOUT that flow will land in:
 * the panel, the position, the Pro/free branch and the copy slot.
 */
export function AICleanReadyState({
  source,
  isPro,
  planKnown,
  onBack,
}: {
  source: { kind: "file"; name: string } | { kind: "link"; url: string };
  isPro: boolean;
  /** False until `/api/me` has answered — see the note below. */
  planKnown: boolean;
  onBack: () => void;
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

        <div className="mt-4 rounded-2xl border border-primary/25 bg-primary/[0.04] p-4">
          <p className="flex items-start gap-2 text-sm font-semibold">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            The cleanup itself isn&apos;t connected yet
          </p>
          <p className="mt-1.5 pl-6 text-sm leading-relaxed text-muted-foreground">
            This release is the AI Clean interface.{" "}
            {source.kind === "file"
              ? "Nothing has been uploaded — your video hasn't left this device."
              : "Nothing has been fetched — the link hasn't been opened."}{" "}
            Text detection and the cleaned result arrive in the next update.
          </p>
        </div>

        {/*
          The future gate's home. Rendered as plainly as it reads: a statement
          about what will be true, never a state that claims to be true now. It
          stays neutral until the plan is actually known, because guessing "free"
          at a paying member is the expensive direction of that guess.
        */}
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          {!planKnown
            ? "AI Clean will be included with Pro when it ships."
            : isPro
              ? "AI Clean will be included with your Pro plan when it ships — no ads, no daily cap."
              : "When it ships, free members will get 3 AI Clean videos a day, each unlocked by watching a short ad. Pro removes both."}
        </p>

        <button type="button" onClick={onBack} className="btn-lux btn-lux-secondary mt-6 w-full sm:w-auto">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to the video
        </button>
      </div>
    </div>
  );
}
