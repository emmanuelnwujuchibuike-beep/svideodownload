"use client";

import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CharacterReplaceProcessing } from "@/features/ai/character-replace/processing";
import { CharacterReplaceResultScreen } from "@/features/ai/character-replace/result";
import { CharacterReplacePhotoStep } from "@/features/ai/character-replace/step-photo";
import { CharacterReplaceReviewStep } from "@/features/ai/character-replace/step-review";
import { CharacterReplaceSettingsStep } from "@/features/ai/character-replace/step-settings";
import { CharacterReplaceVideoStep } from "@/features/ai/character-replace/step-video";
import { CharacterReplaceVoiceStep } from "@/features/ai/character-replace/step-voice";
import { CharacterReplaceStepper } from "@/features/ai/character-replace/stepper";
import { useCharacterReplaceWorkspace } from "@/features/ai/character-replace/use-character-replace-workspace";
import { useJobWatch } from "@/features/ai/character-replace/use-job-watch";
import { FrenzAIEnvironment } from "@/features/ai/core/frenz-ai-environment";
import { FrenzAICrumb } from "@/features/ai/frenz-ai-chrome";
import type { CharacterReplaceResult } from "@/lib/ai/character-replace/types";
import { inputReadiness } from "@/lib/ai/character-replace/validate";
import {
  canEnterStep,
  canStart,
  furthestStep,
  stepIndex,
  WORKSPACE_STEPS,
  type WorkspaceStep,
} from "@/lib/ai/character-replace/workspace";
import { cn } from "@/lib/utils";

/**
 * Part 4 flips this when /start exists. Until then Start stays disabled after
 * everything else is green, and the sentence under it says so.
 */
const PROCESSING_AVAILABLE = false;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CHARACTER REPLACE — the workspace
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * One client tree, code-split by its route (this component is only imported
 * by /ai/character-replace and its Studio twin), holding the five-step draft
 * and the two screens that follow it. The draft is a pure reducer
 * (lib/ai/character-replace/workspace.ts); this file composes screens and
 * decides which one is up.
 *
 * ── Three phases ────────────────────────────────────────────────────────────
 *
 *   draft        the stepper and the five steps. Everything in Part 1.
 *   processing   a `ProcessingJob`, from `useJobWatch`. Reached today by the
 *                push notification's `?job=` link; reached by Start in Part 2.
 *   result       the finished job, from the same watch.
 *
 * ── 🔴 START DOES NOTHING EXPENSIVE, AND SAYS SO ────────────────────────────
 *
 * Since Part 3 `canStart` can be true — a signed quote, enough balance,
 * consent — but Part 3 forbids processing ("Do NOT process AI jobs"), so the
 * button is ALSO gated on `PROCESSING_AVAILABLE`, false here and flipped by
 * Part 4 when the pipeline exists. The sentence under the button says which
 * of the two is holding it. No request leaves the browser when it is pressed,
 * because it cannot be pressed. §20 is kept structurally, not by remembering.
 *
 * ── The action bar is sticky and safe-area aware ────────────────────────────
 *
 * On a phone the one primary action sits above the home indicator, always in
 * reach, with the step content scrolling beneath it. `env(safe-area-inset-
 * bottom)` keeps it off the indicator on iOS; the bottom nav, where present,
 * is accounted for by the page's own padding.
 */
export function CharacterReplaceWorkspace({
  basePath = "/ai/character-replace",
  aiHref = "/ai",
  historyHref = "/ai/history",
}: {
  /** This page's own path — where Paystack returns to. Allow-listed server-side. */
  basePath?: string;
  aiHref?: string;
  historyHref?: string;
}) {
  const ws = useCharacterReplaceWorkspace();
  const { state, loads, send } = ws;
  const { project, step } = state;

  /*
    `?job=` is the push notification's own link. Read once from `location`
    rather than `useSearchParams` — that hook opts the whole tree into a
    Suspense boundary it does not otherwise need — and removed from the URL
    so a reload or a back-swipe does not drag the finished job back over a
    fresh draft.
  */
  const [watchedJobId, setWatchedJobId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("job");
    const wanted = params.get("preview");
    if (id) setWatchedJobId(id);
    // 🔴 Development only. Compiled out of a production bundle: Next inlines
    // NODE_ENV, so this branch is dead code there and the param is ignored.
    if (process.env.NODE_ENV !== "production" && wanted) setPreview(wanted);
    if (id || wanted) {
      params.delete("job");
      params.delete("preview");
      const rest = params.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
    }
  }, []);
  const watch = useJobWatch(watchedJobId);

  const goTo = useCallback((next: WorkspaceStep) => send({ type: "go", step: next }), [send]);
  const index = stepIndex(step);
  const config = loads.config;

  const continueAllowed = useMemo(() => {
    const next = WORKSPACE_STEPS[index + 1]?.id;
    if (!next) return false;
    if (!canEnterStep(project, next)) return false;
    /*
      🔴 THE READINESS LAYER IS THE GATE (Part 2, §15). From the video step
      onward, Continue waits for both files to be valid and the kept range to
      fit — one function, lib/ai/character-replace/validate.ts, that the
      summary card reads too, so the button and the card never disagree.
    */
    if ((step === "video" || step === "settings") && !inputReadiness(project, config).ready) return false;
    // The voice step holds until a new voice is fully described.
    if (step === "voice" && project.voice.mode === "new_voice" && (!project.voice.languageCode || !project.voice.voiceId || !project.lipSync.tier)) return false;
    return true;
  }, [config, index, project, step]);

  const readyToStart = canStart({
    project,
    pricing: state.pricing,
    config,
    available: loads.available === true,
    balanceCents: loads.balance?.balanceCents ?? null,
  });
  const startAllowed = readyToStart && PROCESSING_AVAILABLE;

  /* ─────────────────────────── which screen ───────────────────────────── */

  const previewJob = process.env.NODE_ENV !== "production" ? devPreview(preview) : null;
  const processing = previewJob?.processing ?? watch.processing;
  const result: CharacterReplaceResult | null =
    previewJob?.result ??
    (watch.job && watch.job.status === "completed"
      ? { job: watch.job, previewUrl: watch.previewUrl, durationSeconds: watch.job.result.durationSeconds ?? watch.job.source.durationSeconds, quality: null, voice: null, lipSync: null }
      : null);

  const leaveJob = useCallback(() => {
    setWatchedJobId(null);
    setPreview(null);
    send({ type: "reset" });
  }, [send]);

  const envStage = processing ? (processing.status === "complete" ? "completed" : processing.status === "failed" || processing.status === "refunded" ? "failed" : "processing") : "idle";

  return (
    <FrenzAIEnvironment stage={envStage} armed={!!project.character} bare>
      <div className="px-1 pb-2">
        <FrenzAICrumb tool="Character Replace" />

        {result ? (
          <>
            <Headline title="Your video is" highlight="ready." subtitle={null} />
            <CharacterReplaceResultScreen result={result} config={config} historyHref={historyHref} onMakeAnother={leaveJob} className="mt-5" />
          </>
        ) : processing ? (
          <>
            <Headline title="Replacing the" highlight="character." subtitle={null} />
            <CharacterReplaceProcessing
              job={processing}
              onCancel={processing.canCancel ? () => void watch.cancel() : undefined}
              onRetry={leaveJob}
              onDone={() => undefined}
              className="mt-5"
            />
          </>
        ) : watchedJobId && !watch.missing && !watch.job ? (
          <>
            <Headline title="Opening your" highlight="video." subtitle={null} />
            <div className="mt-5 h-40 animate-pulse rounded-[1.5rem] bg-secondary/60" aria-busy="true" aria-label="Loading" />
          </>
        ) : loads.available === false ? (
          <>
            <Headline title="Put yourself into" highlight="your video." subtitle={null} />
            <Unavailable reason={loads.configError} aiHref={aiHref} />
          </>
        ) : (
          <>
            <Headline
              title="Put yourself into"
              highlight="your video."
              subtitle="Replace the person in a video with your own likeness while preserving the original movement, expressions, scene and camera motion."
            />

            <CharacterReplaceStepper current={step} furthest={furthestStep(project)} onGo={goTo} className="mt-6" />

            <section aria-labelledby="cr-step-title" className="mt-6">
              <h2 id="cr-step-title" className="text-[19px] font-bold tracking-[-0.02em]">
                {WORKSPACE_STEPS[index]?.title}
              </h2>

              <div className="mt-4">
                {step === "photo" ? (
                  <CharacterReplacePhotoStep
                    asset={project.character}
                    slot={state.photo}
                    onPick={(f) => void ws.pickPhoto(f)}
                    onClear={ws.clearPhoto}
                  />
                ) : step === "video" ? (
                  <CharacterReplaceVideoStep
                    project={project}
                    slot={state.video}
                    config={config}
                    onPick={(f) => void ws.pickVideo(f)}
                    onClear={ws.clearVideo}
                  />
                ) : !config ? (
                  <ConfigWait error={loads.configError} />
                ) : step === "settings" ? (
                  <CharacterReplaceSettingsStep
                    project={project}
                    config={config}
                    pricing={state.pricing}
                    onRetryQuote={ws.requote}
                    onQuality={(quality) => send({ type: "quality", quality })}
                    onTrim={(start, end) => send({ type: "trim", start, end })}
                    onTrimClear={() => send({ type: "trim/clear" })}
                  />
                ) : step === "voice" ? (
                  <CharacterReplaceVoiceStep
                    project={project}
                    config={config}
                    onMode={(mode) =>
                      send({
                        type: "voice/mode",
                        mode,
                        defaults: {
                          languageCode: config.languages[0]?.code ?? null,
                          voiceId: config.voices[0]?.id ?? null,
                          tier: config.lipSync[0]?.id ?? null,
                        },
                      })
                    }
                    onLanguage={(code) => send({ type: "voice/language", code })}
                    onVoice={(id) => send({ type: "voice/voice", id })}
                    onTier={(tier) => send({ type: "lipsync/tier", tier })}
                  />
                ) : (
                  <CharacterReplaceReviewStep
                    project={project}
                    config={config}
                    pricing={state.pricing}
                    balance={loads.balance}
                    balanceError={loads.balanceError}
                    topupNotice={loads.topupNotice}
                    onDismissTopupNotice={ws.dismissTopupNotice}
                    onRetryQuote={ws.requote}
                    returnTo={basePath}
                    onConsent={(value) => send({ type: "consent", value })}
                  />
                )}
              </div>
            </section>

            {/* ── the action bar ─────────────────────────────────────────── */}
            <div
              className="sticky z-10 -mx-1 mt-6 flex items-center gap-2 border-t border-border/60 bg-background/90 px-1 pt-3 backdrop-blur-md"
              style={{
                /*
                  Docked above the phone's bottom nav, whose measured height the
                  nav publishes as `--frenz-bottomnav-h` (0 where it is not
                  mounted). The nav already pads for the home indicator, so the
                  safe-area inset is added only when there is no nav to carry it:
                  max() picks the plain padding whenever the nav is taller than
                  the inset, which on every phone with a nav it is.
                */
                bottom: "var(--frenz-bottomnav-h, 0px)",
                paddingBottom:
                  "max(0.75rem, calc(0.75rem + env(safe-area-inset-bottom, 0px) - var(--frenz-bottomnav-h, 0px)))",
              }}
            >
              {index > 0 ? (
                <button
                  type="button"
                  onClick={() => goTo(WORKSPACE_STEPS[index - 1]!.id)}
                  className="btn-lux min-h-[48px] border border-border/70 bg-card text-foreground hover:border-foreground/25"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  Back
                </button>
              ) : (
                <Link href={aiHref} prefetch={false} className="btn-lux min-h-[48px] border border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground">
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  Frenz AI
                </Link>
              )}

              <div className="min-w-0 flex-1" />

              {step === "review" ? (
                <button
                  type="button"
                  disabled={!startAllowed}
                  className={cn(
                    "inline-flex min-h-[48px] items-center gap-2 rounded-full px-6 text-[14px] font-bold text-white",
                    "bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500 shadow-[0_14px_34px_-14px_rgb(99_102_241/0.9)]",
                    "transition motion-safe:hover:-translate-y-0.5 active:scale-[0.99]",
                    "disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:hover:translate-y-0",
                  )}
                >
                  <Sparkles className="h-4 w-4" aria-hidden />
                  Start
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!continueAllowed}
                  onClick={() => goTo(WORKSPACE_STEPS[index + 1]!.id)}
                  className={cn(
                    "inline-flex min-h-[48px] items-center gap-2 rounded-full bg-foreground px-6 text-[14px] font-bold text-background",
                    "transition motion-safe:hover:-translate-y-0.5 active:scale-[0.99]",
                    "disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0",
                  )}
                >
                  Continue
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>

            {step === "review" ? (
              <p className="mt-3 text-center text-[12.5px] leading-relaxed text-muted-foreground" aria-live="polite">
                {!project.consent
                  ? "Confirm you have the right to use this likeness to continue."
                  : config && !config.pricingAvailable
                    ? "Processing isn't switched on yet. Your files stay on your device and nothing is charged."
                    : readyToStart && !PROCESSING_AVAILABLE
                      ? "Processing isn't switched on yet. Your price is confirmed and nothing has been charged."
                    : state.pricing.status === "error"
                      ? "We couldn't price this video yet."
                      : state.pricing.status !== "quoted"
                        ? "Getting the exact price…"
                        : loads.balance && loads.balance.balanceCents < state.pricing.snapshot.totalCents
                          ? "Recharge your balance to start."
                          : "You'll be charged the amount shown when processing starts."}
              </p>
            ) : null}
          </>
        )}
      </div>
    </FrenzAIEnvironment>
  );
}

/* ───────────────────────────── pieces ────────────────────────────────────── */

function Headline({ title, highlight, subtitle }: { title: string; highlight: string; subtitle: string | null }) {
  return (
    <header className="mt-4">
      <h1 className="text-[1.95rem] font-bold leading-[1.08] tracking-[-0.04em] sm:text-[2.3rem]">
        {title} <span className="text-gradient">{highlight}</span>
      </h1>
      {subtitle ? <p className="mt-2.5 max-w-md text-[14.5px] leading-relaxed text-muted-foreground">{subtitle}</p> : null}
    </header>
  );
}

function Unavailable({ reason, aiHref }: { reason: string | null; aiHref: string }) {
  return (
    <div className="mt-6 rounded-[1.5rem] border border-border/70 bg-card px-5 py-6 text-center">
      <h2 className="text-[17px] font-bold tracking-[-0.01em]">Character Replace isn&apos;t available right now</h2>
      <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed text-muted-foreground">
        {reason ?? "It has been switched off for the moment. Nothing on your account is affected — check back soon."}
      </p>
      <Link href={aiHref} prefetch={false} className="btn-lux mt-5 bg-foreground text-background">
        Back to Frenz AI
      </Link>
    </div>
  );
}

function ConfigWait({ error }: { error: string | null }) {
  return (
    <div role="status" aria-busy={!error} className="relative overflow-hidden rounded-[1.25rem] border border-border/70 bg-card px-4 py-4">
      <p className="text-[13.5px] font-semibold">{error ? "Couldn't load the options" : "Loading the options…"}</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
        {error ?? "Qualities, voices and languages come from Frenz AI so they are always current."}
      </p>
      {!error ? (
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden bg-primary/10">
          <span className="frenz-loader-bar block h-full w-2/5 bg-gradient-to-r from-blue-500 via-violet-500 to-fuchsia-500" />
        </span>
      ) : null}
    </div>
  );
}

/**
 * Development-only fixtures for the two screens Part 1 cannot reach through
 * real use. `?preview=processing|failed|refunded|result`. Dead code in a
 * production bundle — see the NODE_ENV check at the call site.
 */
function devPreview(name: string | null): { processing?: import("@/lib/ai/character-replace/types").ProcessingJob; result?: CharacterReplaceResult } | null {
  if (!name) return null;
  const job: import("@/lib/ai/jobs").AiJobView = {
    id: "00000000-0000-4000-8000-000000000000",
    feature: "ai_character_replace",
    status: name === "result" ? "completed" : name === "failed" || name === "refunded" ? "failed" : "processing",
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    completedAt: name === "result" ? new Date().toISOString() : null,
    expiresAt: null,
    durationMs: null,
    source: { size: 6_165_585, mimeType: "video/mp4", durationSeconds: 18.437, name: "beach-walk.mp4", kind: "upload" },
    result: { size: null, durationSeconds: 10, audioRestored: null, hasPoster: false },
    error: null,
  };
  if (name === "result") {
    return { result: { job, previewUrl: null, durationSeconds: 10, quality: "720p", voice: { mode: "original", languageCode: null, voiceId: null }, lipSync: { tier: null } } };
  }
  if (name === "uploading") {
    return { processing: { status: "uploading", job: null, progress: 0.42, estimatedSecondsRemaining: null, canCancel: true, message: null } };
  }
  return {
    processing: {
      status: name === "failed" ? "failed" : name === "refunded" ? "refunded" : name === "queued" ? "queued" : "processing",
      job,
      progress: null,
      estimatedSecondsRemaining: name === "processing" ? 140 : null,
      canCancel: name === "queued",
      message: null,
    },
  };
}
