"use client";

import { ArrowLeft, ArrowRight, Plus, Sparkles } from "lucide-react";
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
import type { CharacterReplaceResult, ProcessingJob } from "@/lib/ai/character-replace/types";
import { inputReadiness } from "@/lib/ai/character-replace/validate";
import {
  canEnterStep,
  canStart,
  furthestStep,
  stepIndex,
  voiceComplete,
  WORKSPACE_STEPS,
  type WorkspaceStep,
} from "@/lib/ai/character-replace/workspace";
import { formatCents } from "@/lib/ai/economy";
import { track } from "@/lib/analytics/client";
import { cn } from "@/lib/utils";

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
 * `canStart` is true only with a signed quote, enough balance and consent,
 * and the button is ALSO gated on `loads.processingAvailable` — the server's
 * word that a provider token and a worker exist on this deployment (Part 4).
 * The sentence under the button says which of the two is holding it. What a
 * press does is the hook's `start`: open the job, upload both files, hand the
 * signed quote to /start. The browser never prices, charges or submits.
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
  initialJobId = null,
}: {
  /** This page's own path — where Paystack returns to. Allow-listed server-side. */
  basePath?: string;
  aiHref?: string;
  historyHref?: string;
  /** Part 7: the job this page was opened FOR (the result route). Ownership was checked server-side before render. */
  initialJobId?: string | null;
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
  const [watchedJobId, setWatchedJobId] = useState<string | null>(initialJobId);
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
    // The voice step holds until a new voice is fully described (Part 6: source, file + rights, or dialogue + language + voice).
    if (step === "voice" && !voiceComplete(project, config)) return false;
    return true;
  }, [config, index, project, step]);

  const readyToStart = canStart({
    project,
    pricing: state.pricing,
    config,
    available: loads.available === true,
    balanceCents: loads.balance?.balanceCents ?? null,
  });
  const processingAvailable = loads.processingAvailable === true;
  const launching = ws.launch.phase !== "idle" && ws.launch.phase !== "error";
  const startAllowed = readyToStart && processingAvailable && !launching;
  /*
    Part 9 §13: the button names the action and the price — "Create Video ·
    ₦450.00" — never a bare "Start". Short of balance it becomes "Recharge to
    continue" and opens the recharge sheet, so a failed start is never the
    way a member learns their balance is low. Both figures are the server's:
    the quote's total and the balance route's answer.
  */
  const quotedTotal = state.pricing.status === "quoted" || state.pricing.status === "stale" ? state.pricing.snapshot : null;
  const balanceKnown = loads.balance?.balanceCents ?? null;
  const shortOfBalance = !!quotedTotal && balanceKnown !== null && balanceKnown < quotedTotal.totalCents;
  const [rechargeAsk, setRechargeAsk] = useState(0);

  const onStart = useCallback(async () => {
    const id = await ws.start();
    if (id) setWatchedJobId(id);
  }, [ws]);

  /* ─────────────────────────── which screen ───────────────────────────── */

  const previewJob = process.env.NODE_ENV !== "production" ? devPreview(preview) : null;
  /*
    The browser's own phases come first: while the files are still leaving
    the device there is no row to watch, and the two of them are the only
    measured progress this screen ever shows (§21: no invented percentages).
  */
  const launchJob: ProcessingJob | null =
    ws.launch.phase === "preparing"
      ? { status: "preparing", job: null, progress: null, estimatedSecondsRemaining: null, canCancel: false, message: null }
      : ws.launch.phase === "uploading"
        ? { status: "uploading", job: null, progress: ws.launch.progress, estimatedSecondsRemaining: null, canCancel: false, message: null }
        : ws.launch.phase === "starting"
          ? { status: "queued", job: null, progress: null, estimatedSecondsRemaining: null, canCancel: false, message: null }
          : null;
  const processing = previewJob?.processing ?? launchJob ?? watch.processing;
  const result: CharacterReplaceResult | null =
    previewJob?.result ??
    (watch.job && watch.job.status === "completed"
      ? {
          job: watch.job,
          previewUrl: watch.previewUrl,
          durationSeconds: watch.job.result.durationSeconds ?? (watch.job.characterReplace?.selectedDurationMs ? watch.job.characterReplace.selectedDurationMs / 1000 : null) ?? watch.job.source.durationSeconds,
          quality: (watch.job.characterReplace?.quality as CharacterReplaceResult["quality"]) ?? null,
          mode: watch.job.characterReplace?.mode ?? null,
          voice: watch.job.characterReplace ? { mode: watch.job.characterReplace.voiceMode, source: watch.job.characterReplace.voiceSource, languageCode: null, voiceId: null } : null,
          lipSync: watch.job.characterReplace?.lipSyncMode ? { tier: watch.job.characterReplace.lipSyncMode } : null,
        }
      : null);

  const leaveJob = useCallback(
    (opts?: { keepPhoto?: boolean }) => {
      setWatchedJobId(null);
      setPreview(null);
      // Part 7 §15–§16: "Use same photo" keeps the character photo (and the mode) still in the browser's hand; nothing is re-read.
      send({ type: opts?.keepPhoto && project.character ? "reset/keep-photo" : "reset" });
      if (initialJobId) window.history.replaceState(window.history.state, "", basePath);
    },
    [basePath, initialJobId, project.character, send],
  );
  /* Part 7 §20/§27: after a delete, this page shows the deleted state rather than a stale player. */
  const [deletedLocally, setDeletedLocally] = useState(false);

  // §7: a fresh attempt of the same draft, linked to the one that failed.
  const retryJob = useCallback(() => {
    const failed = watch.job?.id ?? null;
    track("character_replace_retry_clicked", { mode: watch.job?.characterReplace?.mode ?? project.mode });
    setWatchedJobId(null);
    setPreview(null);
    if (failed) ws.retryFrom(failed);
    else send({ type: "reset" });
    if (initialJobId) window.history.replaceState(window.history.state, "", basePath);
  }, [basePath, initialJobId, project.mode, send, watch.job?.characterReplace?.mode, watch.job?.id, ws]);

  /* §27 — the states a job id can be in that are not "processing" or "ready" */
  const terminalNotice: { title: string; body: string } | null =
    deletedLocally || watch.job?.status === "deleted"
      ? { title: "This video has been deleted", body: "You removed it from FrenzSave. Your charge record is kept in your usage history." }
      : watch.job?.status === "expired"
        ? { title: "This result is no longer available", body: `Finished videos are kept for ${config?.retention.resultHours ? (config.retention.resultHours >= 48 ? `${Math.round(config.retention.resultHours / 24)} days` : `${config.retention.resultHours} hours`) : "a limited time"} — saved ones for ${config?.retention.savedResultDays ?? 30} days. This one has passed its date and its files have been removed.` }
        : watchedJobId && watch.missing
          ? { title: "We couldn't find that video", body: "It may have been removed, or the link isn't yours to open." }
          : null;

  const envStage = processing ? (processing.status === "complete" ? "completed" : processing.status === "failed" || processing.status === "refunded" ? "failed" : "processing") : "idle";

  return (
    <FrenzAIEnvironment stage={envStage} armed={!!project.character} bare>
      <div className="px-1 pb-2">
        <FrenzAICrumb tool="Character Replace" />

        {terminalNotice ? (
          <>
            <Headline title={terminalNotice.title.split(" ").slice(0, -1).join(" ")} highlight={terminalNotice.title.split(" ").slice(-1)[0] + "."} subtitle={null} />
            <TerminalNotice body={terminalNotice.body} historyHref={historyHref} onNew={() => leaveJob()} />
          </>
        ) : result ? (
          /* Video Ready owns its own header (Back · Your video is ready · Ready) — no page headline above it. */
          <CharacterReplaceResultScreen
            result={result}
            config={config}
            historyHref={historyHref}
            onMakeAnother={leaveJob}
            onBack={() => leaveJob()}
            onDeleted={() => setDeletedLocally(true)}
            className="mt-3"
          />
        ) : processing ? (
          <>
            <Headline
              title={processing.job?.characterReplace?.mode === "face_only" ? "Replacing the" : processing.job?.characterReplace?.mode === "skin_face" ? "Transferring the" : "Replacing the"}
              highlight={processing.job?.characterReplace?.mode === "face_only" ? "face." : processing.job?.characterReplace?.mode === "skin_face" ? "identity." : "character."}
              subtitle={null}
            />
            <CharacterReplaceProcessing
              job={processing}
              mode={processing.job?.characterReplace?.mode ?? project.mode}
              onCancel={processing.canCancel ? () => void watch.cancel() : undefined}
              onRetry={retryJob}
              onDone={() => undefined}
              historyHref={historyHref}
              symbol={loads.balance?.symbol ?? config?.symbol ?? "₦"}
              previews={{ photoUrl: project.character?.objectUrl ?? null, videoUrl: project.video?.objectUrl ?? null }}
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
            {loads.processingNotice ? (
              /* Part 8 §2, §30: the operator's notice, shown before a single file is chosen — not only at Start. */
              <div role="status" className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[13px] font-medium leading-relaxed text-foreground">
                {loads.processingNotice}
              </div>
            ) : null}

            <section aria-labelledby="cr-step-title" className="mt-6">
              <h2 id="cr-step-title" className="text-[19px] font-bold tracking-[-0.02em]">
                {WORKSPACE_STEPS[index]?.title}
              </h2>

              <div className="mt-4">
                {step === "photo" ? (
                  <CharacterReplacePhotoStep
                    mode={project.mode}
                    config={config}
                    asset={project.character}
                    references={project.references}
                    maxReferences={config?.modes.find((m) => m.id === project.mode)?.maximumReferenceImages ?? 1}
                    slot={state.photo}
                    onMode={ws.setMode}
                    onPick={(f) => void ws.pickPhoto(f)}
                    onClear={ws.clearPhoto}
                    onAddReference={(f) => void ws.addReference(f)}
                    onRemoveReference={ws.removeReference}
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
                    audioSlot={state.audio}
                    onMode={(mode) => {
                      if (mode === "original") ws.clearAudio();
                      const firstLanguage = config.languages.find((l) => config.tts.languages.includes(l.code))?.code ?? null;
                      const firstVoice = config.voices.find((v) => v.languages.length === 0 || (firstLanguage !== null && v.languages.includes(firstLanguage)))?.id ?? null;
                      send({
                        type: "voice/mode",
                        mode,
                        defaults: {
                          languageCode: firstLanguage,
                          voiceId: firstVoice,
                          // Part 6 §19: lip sync is a toggle the member switches on; it starts off.
                          tier: null,
                          source: config.tts.enabled && firstLanguage ? "tts" : "upload",
                        },
                      });
                    }}
                    onSource={(source) => send({ type: "voice/source", source })}
                    onPickAudio={(f) => void ws.pickAudio(f)}
                    onClearAudio={ws.clearAudio}
                    onTrimToFit={(value) => send({ type: "voice/trimToFit", value })}
                    onVoiceConsent={(value) => send({ type: "voice/consent", value })}
                    onText={(text) => send({ type: "voice/text", text })}
                    onLanguage={(code) => {
                      send({ type: "voice/language", code });
                      // A voice that does not speak the new language falls back to the first that does.
                      const current = config.voices.find((v) => v.id === project.voice.voiceId);
                      if (current && current.languages.length > 0 && !current.languages.includes(code)) {
                        const next = config.voices.find((v) => v.languages.length === 0 || v.languages.includes(code));
                        if (next) send({ type: "voice/voice", id: next.id });
                      }
                    }}
                    onVoice={(id) => send({ type: "voice/voice", id })}
                    onTier={(tier) => send({ type: "lipsync/tier", tier })}
                    onLipSyncOff={() => send({ type: "lipsync/clear" })}
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
                    rechargeAsk={rechargeAsk}
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

              {step === "review" && shortOfBalance && project.consent && !launching ? (
                <button
                  type="button"
                  onClick={() => setRechargeAsk((n) => n + 1)}
                  className={cn(
                    "inline-flex min-h-[48px] items-center gap-2 rounded-full bg-foreground px-6 text-[14px] font-bold text-background",
                    "transition motion-safe:hover:-translate-y-0.5 active:scale-[0.99]",
                  )}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  Recharge to continue
                </button>
              ) : step === "review" ? (
                <button
                  type="button"
                  disabled={!startAllowed}
                  onClick={() => void onStart()}
                  className={cn(
                    "inline-flex min-h-[48px] items-center gap-2 rounded-full px-6 text-[14px] font-bold text-white",
                    "bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500 shadow-[0_14px_34px_-14px_rgb(99_102_241/0.9)]",
                    "transition motion-safe:hover:-translate-y-0.5 active:scale-[0.99]",
                    "disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:hover:translate-y-0",
                  )}
                >
                  <Sparkles className="h-4 w-4" aria-hidden />
                  {launching ? "Starting…" : quotedTotal ? `Create Video · ${formatCents(quotedTotal.totalCents, quotedTotal.symbol)}` : "Create Video"}
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
              <p className={cn("mt-3 text-center text-[12.5px] leading-relaxed", ws.launch.phase === "error" ? "font-semibold text-rose-500" : "text-muted-foreground")} aria-live="polite">
                {!project.consent
                  ? "Confirm you have the right to use this likeness to continue."
                  : config && !config.pricingAvailable
                    ? "Processing isn't switched on yet. Your files stay on your device and nothing is charged."
                    : ws.launch.phase === "error"
                    ? ws.launch.message
                  : readyToStart && !processingAvailable
                      ? (loads.processingNotice ?? "Processing isn't switched on yet. Your price is confirmed and nothing has been charged.")
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

/** §27 — expired, deleted, not found: one calm card, two ways on. Never a stack trace, never someone else's facts. */
function TerminalNotice({ body, historyHref, onNew }: { body: string; historyHref: string; onNew: () => void }) {
  return (
    <div className="mt-6 rounded-[1.5rem] border border-border/70 bg-card px-5 py-6 text-center">
      <p className="mx-auto max-w-sm text-[13.5px] leading-relaxed text-muted-foreground">{body}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={onNew} className="btn-lux bg-foreground text-background">
          <Sparkles className="h-4 w-4" aria-hidden />
          Start a new video
        </button>
        <Link href={historyHref} prefetch={false} className="btn-lux border border-border/70 bg-card text-foreground hover:border-foreground/25">
          Your AI videos
        </Link>
      </div>
    </div>
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
    return { result: { job, previewUrl: null, durationSeconds: 10, quality: "720p", mode: "full_character", voice: { mode: "original", source: null, languageCode: null, voiceId: null }, lipSync: { tier: null } } };
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
