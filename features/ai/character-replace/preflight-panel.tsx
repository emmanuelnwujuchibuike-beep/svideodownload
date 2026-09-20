"use client";

import { ArrowLeft, Check, ImageIcon, RotateCcw, ScanFace, Sparkles, Video, X } from "lucide-react";

import type { CharacterReplacePreflight, PricingSnapshot } from "@/lib/ai/character-replace/types";
import { formatCents } from "@/lib/ai/economy";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  "Checking your media…" · "Ready for AI generation" · "Media needs attention"
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The preflight screen between the uploads and the start (media brief §11).
 * Not an error page: FrenzSave helping a member get a better result before
 * any of their balance is touched (§12, §17). Three states of one panel:
 *
 *   checking   the checklist ticking through while the worker measures
 *   ready      every line ticked, the warnings if any, the price, and the
 *              ONE button that reserves the balance — the member confirms
 *   attention  the headline for the mode, each issue in words, what to try,
 *              and "Choose another photo / video" (never "invalid")
 *
 * Words only — the numbers the engine measured stay on the server.
 */
export type PreflightPanelState =
  | { phase: "checking" }
  | { phase: "ready"; preflight: CharacterReplacePreflight; snapshot: PricingSnapshot | null; balanceCents: number | null }
  | { phase: "attention"; preflight: CharacterReplacePreflight }
  | { phase: "unavailable"; message: string };

export function CharacterReplacePreflightPanel({
  state,
  onConfirm,
  onReplace,
  onRetry,
  onBack,
}: {
  state: PreflightPanelState;
  onConfirm: () => void;
  onReplace: (target: "reference" | "video" | "both") => void;
  onRetry: () => void;
  onBack: () => void;
}) {
  const checklist = state.phase === "ready" || state.phase === "attention" ? state.preflight.checklist : null;
  const ticking = state.phase === "checking";

  return (
    <section aria-live="polite" className="relative mt-3 overflow-hidden rounded-[1.6rem] border border-border/70 bg-card p-5 sm:p-6">
      <span aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-gradient-to-br from-blue-500/15 via-violet-500/10 to-fuchsia-500/15 blur-3xl" />

      {/* ── the headline ─────────────────────────────────────────────────── */}
      <div className="relative flex items-start gap-3">
        <span
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-lg",
            state.phase === "attention" ? "bg-gradient-to-br from-amber-500 to-orange-500 shadow-amber-500/30" : state.phase === "unavailable" ? "bg-gradient-to-br from-slate-500 to-slate-700 shadow-slate-500/30" : "bg-gradient-to-br from-blue-500 to-violet-600 shadow-violet-500/30",
          )}
        >
          {state.phase === "attention" ? <ScanFace className="h-5 w-5" aria-hidden /> : state.phase === "unavailable" ? <RotateCcw className="h-5 w-5" aria-hidden /> : <Sparkles className={cn("h-5 w-5", ticking && "motion-safe:animate-pulse")} aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[1.15rem] font-extrabold tracking-[-0.02em]">
            {state.phase === "checking" ? "Checking your media…" : state.phase === "ready" ? "Ready for AI generation" : state.phase === "attention" ? "Media needs attention" : "We couldn't check your media"}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {state.phase === "checking"
              ? "A quick look at the photo and the video for this replacement type. Nothing is charged for this."
              : state.phase === "ready"
                ? "Your photo and video have what this replacement type needs. Nothing has been charged yet."
                : state.phase === "attention"
                  ? state.preflight.headline?.body
                  : state.message}
          </p>
        </div>
      </div>

      {/* ── the checklist ────────────────────────────────────────────────── */}
      {state.phase !== "unavailable" ? (
        <ul className="relative mt-5 grid gap-2 sm:grid-cols-2">
          {(checklist ?? CHECKING_ROWS).map((row, i) => (
            <li
              key={row.key}
              className={cn(
                "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13.5px] font-semibold ring-1 ring-inset",
                row.state === "fail" ? "bg-amber-500/[0.08] ring-amber-500/30" : row.state === "skip" ? "bg-secondary/40 text-muted-foreground ring-transparent" : "bg-emerald-500/[0.07] ring-emerald-500/25",
                ticking && "motion-safe:animate-fade-up",
              )}
              style={ticking ? { animationDelay: `${i * 90}ms` } : undefined}
            >
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                  row.state === "fail" ? "bg-amber-500 text-white" : row.state === "skip" ? "bg-border text-muted-foreground" : "bg-emerald-500 text-white",
                )}
              >
                {ticking ? <span className="h-2.5 w-2.5 rounded-full bg-white/80 motion-safe:animate-pulse" aria-hidden /> : row.state === "fail" ? <X className="h-3.5 w-3.5" strokeWidth={3} aria-hidden /> : <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />}
              </span>
              {row.label}
              {row.state === "skip" ? <span className="ml-auto text-[11px] font-medium">not needed</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {/* ── ready: warnings, the price, the one button ───────────────────── */}
      {state.phase === "ready" ? (
        <div className="relative mt-5">
          {state.preflight.warnings.length ? (
            <ul className="space-y-1 rounded-2xl bg-secondary/50 px-4 py-3 text-[12.5px] leading-relaxed text-muted-foreground">
              {state.preflight.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">
            A pass means the media has what the model needs and a good chance of a usable result — it isn&apos;t a promise about the final video.
            {state.snapshot ? ` You'll be charged ${formatCents(state.snapshot.totalCents, state.snapshot.symbol)} when processing starts.` : ""}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" onClick={onBack} className="inline-flex min-h-[46px] items-center gap-2 rounded-full border border-border px-4 text-[13.5px] font-semibold transition hover:border-foreground/30">
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back
            </button>
            <button
              type="button"
              onClick={() => {
                haptic("medium");
                onConfirm();
              }}
              className="inline-flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500 px-5 text-[14px] font-bold text-white shadow-[0_12px_28px_-14px_rgba(79,70,229,0.8)] transition active:scale-[0.98] motion-safe:hover:-translate-y-0.5"
            >
              <Sparkles className="h-4 w-4" aria-hidden />
              {state.snapshot ? `Create Video · ${formatCents(state.snapshot.totalCents, state.snapshot.symbol)}` : "Create Video"}
            </button>
          </div>
        </div>
      ) : null}

      {/* ── attention: the issues, in words, and what to try ─────────────── */}
      {state.phase === "attention" ? (
        <div className="relative mt-5 space-y-3">
          {state.preflight.issues.map((issue) => (
            <div key={issue.code} className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3.5">
              <p className="flex items-center gap-2 text-[13.5px] font-bold">
                {issue.target === "video" ? <Video className="h-4 w-4 text-amber-600" aria-hidden /> : <ImageIcon className="h-4 w-4 text-amber-600" aria-hidden />}
                {issue.title}
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{issue.body}</p>
              <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Try</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12.5px] leading-relaxed text-muted-foreground">
                {(issue.target === "video" ? state.preflight.tips.video : state.preflight.tips.reference).map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                {issue.target !== "video" ? (
                  <button type="button" onClick={() => onReplace("reference")} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-foreground px-4 text-[12.5px] font-bold text-background transition active:scale-[0.98]">
                    <ImageIcon className="h-3.5 w-3.5" aria-hidden />
                    Choose another photo
                  </button>
                ) : null}
                {issue.target !== "reference" ? (
                  <button type="button" onClick={() => onReplace("video")} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-foreground px-4 text-[12.5px] font-bold text-background transition active:scale-[0.98]">
                    <Video className="h-3.5 w-3.5" aria-hidden />
                    Choose another video
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          <p className="text-[12px] text-muted-foreground">Nothing has been charged. Your files stay on your device until you choose again.</p>
        </div>
      ) : null}

      {/* ── unavailable: try again, unpaid ───────────────────────────────── */}
      {state.phase === "unavailable" ? (
        <div className="relative mt-5 flex flex-wrap items-center gap-2">
          <button type="button" onClick={onBack} className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-border px-4 text-[13.5px] font-semibold transition hover:border-foreground/30">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back
          </button>
          <button type="button" onClick={onRetry} className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-foreground px-5 text-[13.5px] font-bold text-background transition active:scale-[0.98]">
            <RotateCcw className="h-4 w-4" aria-hidden />
            Check again
          </button>
        </div>
      ) : null}
    </section>
  );
}

const CHECKING_ROWS: CharacterReplacePreflight["checklist"] = [
  { key: "reference", label: "Reference photo", state: "pass" },
  { key: "face", label: "Face detected", state: "pass" },
  { key: "body", label: "Body visibility", state: "pass" },
  { key: "video", label: "Video quality", state: "pass" },
  { key: "subject", label: "Subject visibility", state: "pass" },
  { key: "compatibility", label: "Model compatibility", state: "pass" },
];
