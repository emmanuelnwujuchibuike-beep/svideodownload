"use client";

import { AudioLines, Check, Download, FileAudio, Loader2, Mic, RefreshCcw, Sparkles, Trash2, Type, Upload } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CharacterReplaceMediaPicker } from "@/features/ai/character-replace/media-picker";
import { VideoReadyPlayer } from "@/features/ai/character-replace/video-ready-player";
import { startAiResultDownload } from "@/features/ai/ai-result-download";
import { aiButtonClass } from "@/features/ai/design/ai-button";
import { AiCreditStrip } from "@/features/ai/design/ai-credit-strip";
import { AiShowcase } from "@/features/ai/design/ai-showcase";
import { AiPanel, AiToolTitle } from "@/features/ai/design/ai-surface";
import { FrenzAITrustRow } from "@/features/ai/frenz-ai-chrome";
import { FrenzAIEnvironment } from "@/features/ai/core/frenz-ai-environment";
import { AiPlansSheet } from "@/features/ai/credits/ai-plans-sheet";
import { useLipSyncWorkspace, type LaunchPhase } from "@/features/ai/lip-sync/use-lip-sync-workspace";
import { track } from "@/lib/analytics/client";
import { deleteAiJob, saveAiJob } from "@/lib/ai/client";
import { getAiCredits } from "@/lib/ai/credits/client";
import type { AiPlansPublic } from "@/lib/ai/credits/config";
import { formatCredits } from "@/lib/ai/credits/units";
import { isActiveStatus, type AiJobView } from "@/lib/ai/jobs";
import { LIP_SYNC_EXPRESSIONS } from "@/lib/ai/lip-sync/config";
import type { ShowcaseSlide } from "@/lib/ai/showcase/slides";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LIP SYNC PRO — the workspace (§1, §2, §14)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   Step 1  Upload Video
 *   Step 2  Choose Speech Source — [ Type text ] [ Upload audio ], one or the
 *           other; the text box, the voice, the language and the speed appear
 *           for text only; the audio picker for audio only (§2, §3)
 *   Step 3  the estimate — AI credits, remaining today and this week, the
 *           price — from the server, never computed here
 *   Step 4  [ Generate Lip Sync ]
 *   Step 5  Processing — Preparing speech · Synchronizing lips · Rendering
 *           video · Finalizing (truthful words from the row, no invented %)
 *   Step 6  Result — the same player Video Ready uses, Download, Keep, Delete
 *
 * The controls follow the ACTIVE model's capability flags the server sent
 * (§12): expression only where the model has a temperature, active speaker
 * only where it can detect one, speed only where it means something.
 */
export function LipSyncWorkspace({
  basePath,
  aiHref,
  historyHref,
  usageHref,
  initialJobId = null,
  initialAssetId = null,
  initialVoiceId = null,
  audioHref,
  slides = [],
}: {
  /** The showcase slides, read by the server page — shown on large screens only (owner, 2026-10-05). The result pages pass none. */
  slides?: ShowcaseSlide[];
  basePath: string;
  aiHref: string;
  historyHref: string;
  usageHref: string;
  initialJobId?: string | null;
  initialAssetId?: string | null;
  /** 2026-09-27: a cloned voice preselected from the Voice Library (the server resolves it against the member's own rows). */
  initialVoiceId?: string | null;
  audioHref?: string;
}) {
  const ws = useLipSyncWorkspace({ initialJobId, initialAssetId, initialVoiceId });
  const cfg = ws.config?.config ?? null;
  const [plansSheet, setPlansSheet] = useState(false);
  const [plansCatalogue, setPlansCatalogue] = useState<AiPlansPublic | null>(null);
  const openPlans = useCallback(() => {
    haptic("medium");
    setPlansSheet(true);
    if (!plansCatalogue) void getAiCredits().then((r) => r.ok && setPlansCatalogue(r.plans));
  }, [plansCatalogue]);
  useEffect(() => {
    if (ws.launch.phase === "error" && ws.launch.code === "CR_CREDITS_REQUIRED") openPlans();
  }, [openPlans, ws.launch]);

  const quoted = ws.quote.status === "quoted" ? ws.quote.answer : null;
  const credits = quoted?.credits ?? null;
  const creditsShort = !!credits?.applicable && !credits.affordable && ws.funding !== "wallet";
  const creditsCover = !!credits?.applicable && credits.affordable && ws.funding !== "wallet";
  const complimentary = quoted?.billing.complimentary === true;
  const shortOfBalance = !!quoted && !complimentary && !creditsCover && !quoted.sufficient;
  const launching = ws.launch.phase === "creating" || ws.launch.phase === "uploading" || ws.launch.phase === "starting";
  const canGenerate = !!quoted && !launching && !creditsShort && !shortOfBalance && ws.inputsReady && (ws.config?.processingAvailable ?? false);
  const watching = !!ws.jobId;
  const job = ws.watch.job;

  const envStage = watching && job ? (isActiveStatus(job.status) ? "processing" : job.status === "completed" ? "complete" : "idle") : "idle";

  return (
    <FrenzAIEnvironment stage={envStage as never} armed={!!ws.video} bare>
      <div className="mx-auto w-full max-w-2xl px-4 pb-32 pt-4 sm:px-6">
        {/*
          The shared Frenz AI hero (2026-09-27). The headline still changes
          with the job — that is this screen's whole character and it is kept
          — but the crumb, the type scale and the spacing now come from the
          one definition instead of from a copy that had already drifted a
          step smaller than its siblings (1.9rem against 2rem).
        */}
        {/* Redesign page 7 (owner's reference): showcase on large screens only, the credits strip, then the tool's own title. */}
        <AiShowcase slides={slides} base={aiHref} desktopOnly className="mt-3 mb-3" />
        <AiCreditStrip base={aiHref} className="mt-3 lg:mt-0" />
        <AiToolTitle
          icon={Mic}
          title="Lip Sync Pro"
          tagline={watching ? (job?.status === "completed" ? "Your video is ready." : "Syncing the lips.") : "Make them say anything."}
          body={watching ? null : "Type what they should say, or bring your own audio. The mouth follows the speech; the face, the body and the scene stay theirs."}
          className="mb-5 mt-6"
        />

        {ws.configError ? (
          <Notice tone="error">
            {ws.configError}{" "}
            <button type="button" onClick={() => void ws.reloadConfig()} className="font-semibold underline">
              Try again
            </button>
          </Notice>
        ) : null}
        {ws.config && !ws.config.available ? <Notice tone="muted">{ws.config.unavailableReason ?? "Lip Sync Pro isn't available right now."}</Notice> : null}

        {watching ? (
          <JobStage job={job} missing={ws.watch.missing} previewUrl={ws.watch.previewUrl} onCancel={() => void ws.watch.cancel()} onAnother={ws.reset} historyHref={historyHref} basePath={basePath} />
        ) : ws.config?.available ? (
          <AiPanel className="space-y-6">
            {/* ── Step 1 · the video ─────────────────────────────────────── */}
            <Section n={1} title="Upload video">
              {ws.video ? (
                <div className="flex items-center gap-3 rounded-2xl bg-card ring-1 ring-inset ring-black/[0.08] p-3">
                  <video src={ws.video.objectUrl} muted playsInline preload="metadata" className="h-16 w-12 shrink-0 rounded-lg bg-black object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{ws.video.file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {fmtSeconds(ws.video.durationMs)} · {ws.video.width}×{ws.video.height}
                      {ws.video.hasAudio === false ? " · no sound" : ""}
                    </p>
                  </div>
                  <button type="button" onClick={ws.clearVideo} className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold">
                    Change
                  </button>
                </div>
              ) : (
                <CharacterReplaceMediaPicker kind="video" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" title="Choose a video" hint={`Up to ${cfg?.video.maximumDurationSeconds ?? 60} s · ${Math.round((cfg?.video.maximumUploadBytes ?? 0) / (1024 * 1024))} MB`} formats="MP4 · MOV · WebM" error={null} onPick={(f) => void ws.pickVideo(f)} />
              )}
              {ws.videoError ? <p className="mt-2 text-xs font-semibold text-rose-600">{ws.videoError}</p> : null}
              {ws.video && ws.trim ? (
                <div className="mt-3 rounded-2xl bg-secondary/60 p-3">
                  <p className="text-xs font-semibold">This engine takes up to {cfg?.video.maximumDurationSeconds} seconds — choose which {cfg?.video.maximumDurationSeconds} to keep.</p>
                  <input type="range" min={0} max={Math.max(0, ws.video.durationMs - ws.maxMs)} step={100} value={ws.trimStartMs} onChange={(e) => ws.setTrimStartMs(Number(e.target.value))} className="mt-2 w-full accent-[hsl(var(--primary))]" aria-label="Where the kept part starts" />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Keeping {fmtSeconds(ws.trim.startMs)} → {fmtSeconds(ws.trim.endMs)} of {fmtSeconds(ws.video.durationMs)}. Nothing is cut without you choosing it here.
                  </p>
                </div>
              ) : null}
            </Section>

            {/* ── Step 2 · the speech source ─────────────────────────────── */}
            <Section n={2} title="Choose speech source">
              <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Speech source">
                {cfg?.textMode.enabled ? (
                  <SourceTab active={ws.source === "text"} onClick={() => ws.setSource("text")} icon={<Type className="h-4 w-4" aria-hidden />} label="Type text" hint="They say what you write" />
                ) : null}
                {cfg?.audioMode.enabled ? (
                  <SourceTab active={ws.source === "audio"} onClick={() => ws.setSource("audio")} icon={<FileAudio className="h-4 w-4" aria-hidden />} label="Upload audio" hint="Your own recording" />
                ) : null}
                {/* 2026-09-21 (§4): audio the member already made — reused, never charged twice */}
                {cfg?.audioMode.enabled ? (
                  <SourceTab active={ws.source === "library"} onClick={() => ws.setSource("library")} icon={<AudioLines className="h-4 w-4" aria-hidden />} label="Saved audio" hint="From your Audio Library" />
                ) : null}
              </div>
              {!cfg?.textMode.enabled && !cfg?.audioMode.enabled ? <Notice tone="muted">Neither speech source is available right now.</Notice> : null}

              {ws.source === "text" && cfg?.textMode.enabled ? (
                <div className="mt-4 space-y-4">
                  <label className="block">
                    <span className="text-xs font-semibold text-muted-foreground">What should they say?</span>
                    <textarea value={ws.text} onChange={(e) => ws.setText(e.target.value.slice(0, cfg.textMode.maximumCharacters))} rows={4} placeholder="Enter what the person should say…" className="mt-1 w-full resize-y rounded-2xl border border-border bg-background px-3 py-2.5 text-[15px] leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" maxLength={cfg.textMode.maximumCharacters} />
                    <span className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                      <span>{quoted?.speech.estimateMs ? `About ${fmtSeconds(quoted.speech.estimateMs)} of speech` : " "}</span>
                      <span>
                        {ws.text.trim().length} / {cfg.textMode.maximumCharacters}
                      </span>
                    </span>
                  </label>
                  {/*
                    ── THE SAME PICKER TEXT TO AUDIO USES (owner, 2026-10-05) ───

                    "The lip sync voice selection is supposed to be like the
                    text to audio voice and language selection in grid."

                    These were two native <select> dropdowns — the same voices,
                    the same languages, behind a control that shows one option at
                    a time and cannot show a descriptor at all. Two voices called
                    "Roger" and "Rachel" were indistinguishable without opening
                    the menu and reading to the end of a truncated line.

                    The grid is lifted from `text-to-audio-workspace.tsx` rather
                    than reinvented, including the reasoning already settled
                    there on 2026-09-28: two columns on a phone (not one), a
                    VERTICAL tile because an icon beside the text leaves ~130px
                    for the name on a 390px screen, and a descriptor that is
                    readable rather than 11px muted grey — it is the line that
                    separates two similar names.

                    🔴 The filtering is unchanged: a voice that does not speak
                    the chosen language is still hidden, and choosing a voice
                    that cannot speak the current language moves the language to
                    one it can — the same correction Text to Audio makes.
                  */}
                  {cfg.capabilities.supports_voice_selection && cfg.voices.length ? (
                    <div>
                      <p className="mb-1.5 text-[12px] font-semibold">Voice</p>
                      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                        <button
                          type="button"
                          onClick={() => {
                            haptic("selection");
                            ws.setVoiceId(null);
                          }}
                          aria-pressed={!ws.voiceId}
                          className={cn(
                            "flex min-h-[86px] flex-col rounded-2xl px-2.5 py-2.5 text-left transition active:scale-[0.98] motion-reduce:active:scale-100",
                            !ws.voiceId ? "bg-indigo-50/80 text-indigo-950 ring-2 ring-inset ring-indigo-400/80" : "bg-card ring-1 ring-inset ring-black/[0.08] hover:ring-indigo-300/60",
                          )}
                        >
                          <span className={cn("mb-1.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg", !ws.voiceId ? "bg-white text-indigo-600" : "bg-primary/10 text-primary")}>
                            <Mic className="h-3.5 w-3.5" aria-hidden />
                          </span>
                          <span className="line-clamp-2 text-[12.5px] font-semibold leading-tight">Default voice</span>
                          <span className={cn("mt-0.5 line-clamp-1 text-[11px] font-medium", !ws.voiceId ? "text-indigo-900/70" : "text-foreground/55")}>Chosen for you</span>
                        </button>
                        {cfg.voices
                          .filter((v) => !ws.languageCode || !v.languages.length || v.languages.includes(ws.languageCode))
                          .map((v) => (
                            <button
                              key={v.id}
                              type="button"
                              onClick={() => {
                                haptic("selection");
                                ws.setVoiceId(v.id);
                                if (v.languages.length && ws.languageCode && !v.languages.includes(ws.languageCode)) ws.setLanguageCode(v.languages[0] ?? null);
                              }}
                              aria-pressed={ws.voiceId === v.id}
                              className={cn(
                                "flex min-h-[86px] flex-col rounded-2xl px-2.5 py-2.5 text-left transition active:scale-[0.98] motion-reduce:active:scale-100",
                                ws.voiceId === v.id ? "bg-indigo-50/80 text-indigo-950 ring-2 ring-inset ring-indigo-400/80" : "bg-card ring-1 ring-inset ring-black/[0.08] hover:ring-indigo-300/60",
                              )}
                            >
                              <span className={cn("mb-1.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg", ws.voiceId === v.id ? "bg-white text-indigo-600" : "bg-primary/10 text-primary")}>
                                <Mic className="h-3.5 w-3.5" aria-hidden />
                              </span>
                              <span className="line-clamp-2 text-[12.5px] font-semibold leading-tight">{v.label}</span>
                              {v.blurb ? (
                                <span className={cn("mt-0.5 line-clamp-1 text-[11px] font-medium", ws.voiceId === v.id ? "text-indigo-900/70" : "text-foreground/55")}>{v.blurb}</span>
                              ) : null}
                            </button>
                          ))}
                      </div>
                    </div>
                  ) : null}
                  {cfg.capabilities.supports_language && cfg.languages.length ? (
                    <div>
                      <p className="mb-1.5 text-[12px] font-semibold">Language</p>
                      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                        <button
                          type="button"
                          onClick={() => {
                            haptic("selection");
                            ws.setLanguageCode(null);
                          }}
                          aria-pressed={!ws.languageCode}
                          className={cn("min-h-[44px] rounded-2xl border px-2 py-1.5 text-center transition active:scale-[0.98] motion-reduce:active:scale-100", !ws.languageCode ? "border-indigo-400 bg-indigo-50/80 text-indigo-950" : "border-border bg-card hover:bg-secondary/40")}
                        >
                          <span className="block text-[12.5px] font-bold">Auto</span>
                        </button>
                        {cfg.languages.map((l) => (
                          <button
                            key={l.code}
                            type="button"
                            onClick={() => {
                              haptic("selection");
                              ws.setLanguageCode(l.code);
                            }}
                            aria-pressed={ws.languageCode === l.code}
                            className={cn("min-h-[44px] rounded-2xl border px-2 py-1.5 text-center transition active:scale-[0.98] motion-reduce:active:scale-100", ws.languageCode === l.code ? "border-indigo-400 bg-indigo-50/80 text-indigo-950" : "border-border bg-card hover:bg-secondary/40")}
                          >
                            <span className="block text-[12.5px] font-bold">{l.label}</span>
                            {l.native && l.native !== l.label ? (
                              <span className={cn("block text-[10.5px] font-medium", ws.languageCode === l.code ? "text-background/75" : "text-foreground/55")}>{l.native}</span>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {cfg.capabilities.supports_speed ? (
                    <label className="block">
                      <span className="flex justify-between text-xs font-semibold text-muted-foreground">
                        <span>Speed</span>
                        <span className="tabular-nums">{ws.speed.toFixed(1)}×</span>
                      </span>
                      <input type="range" min={cfg.textMode.speed.min} max={cfg.textMode.speed.max} step={0.1} value={ws.speed} onChange={(e) => ws.setSpeed(Number(e.target.value))} className="mt-1 w-full accent-[hsl(var(--primary))]" />
                      <span className="flex justify-between text-[11px] text-muted-foreground">
                        <span>{cfg.textMode.speed.min}×</span>
                        <span>{cfg.textMode.speed.max}×</span>
                      </span>
                    </label>
                  ) : null}
                </div>
              ) : null}

              {ws.source === "audio" && cfg?.audioMode.enabled ? (
                <div className="mt-4">
                  {ws.audio ? (
                    <div className="flex items-center gap-3 rounded-2xl bg-card ring-1 ring-inset ring-black/[0.08] p-3">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                        <AudioLines className="h-5 w-5" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{ws.audio.file.name}</p>
                        <p className="text-xs text-muted-foreground">Duration: {ws.audio.durationMs ? fmtClock(ws.audio.durationMs) : "measuring on the server"}</p>
                      </div>
                      <button type="button" onClick={ws.clearAudio} className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold">
                        Change
                      </button>
                    </div>
                  ) : (
                    <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card px-4 py-8 text-center transition hover:bg-secondary/40">
                      <Upload className="h-6 w-6 text-primary" aria-hidden />
                      <span className="text-sm font-semibold">Upload audio</span>
                      <span className="text-xs text-muted-foreground">
                        {cfg.audioMode.formats.map((f) => f.label).join(" · ")} · up to {cfg.audioMode.maximumDurationSeconds} s
                      </span>
                      <input
                        type="file"
                        accept={cfg.audioMode.formats.flatMap((f) => [...f.mimeTypes, ...f.extensions.map((e) => `.${e}`)]).join(",")}
                        className="sr-only"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void ws.pickAudio(f);
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                  )}
                  {ws.audioError ? <p className="mt-2 text-xs font-semibold text-rose-600">{ws.audioError}</p> : null}
                  <p className="mt-2 text-[11px] text-muted-foreground">Your audio is the voice — nothing is re-recorded or re-voiced.</p>
                </div>
              ) : null}

              {ws.source === "library" && cfg?.audioMode.enabled ? (
                <div className="mt-4">
                  {ws.libraryError ? (
                    <Notice tone="error">
                      {ws.libraryError}{" "}
                      <button type="button" onClick={() => void ws.reloadLibrary()} className="font-semibold underline underline-offset-2">
                        Try again
                      </button>
                    </Notice>
                  ) : ws.library === null ? (
                    <div className="h-20 animate-pulse rounded-2xl bg-secondary/60" aria-busy="true" aria-label="Loading your audio" />
                  ) : ws.library.length === 0 ? (
                    <Notice tone="muted">
                      Your Audio Library is empty.{" "}
                      {audioHref ? (
                        <Link href={audioHref} className="font-semibold underline underline-offset-2">
                          Make audio from text
                        </Link>
                      ) : null}
                    </Notice>
                  ) : (
                    <ul className="space-y-2">
                      {ws.library.map((a) => (
                        <li key={a.id}>
                          <button
                            type="button"
                            onClick={() => ws.setAssetId(a.id)}
                            aria-pressed={ws.assetId === a.id}
                            className={cn("flex w-full min-h-[60px] items-center gap-3 rounded-2xl border px-3 py-2 text-left transition", ws.assetId === a.id ? "border-indigo-400 bg-indigo-50/80 text-indigo-950" : "border-border bg-card hover:bg-secondary/40")}
                          >
                            <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", ws.assetId === a.id ? "bg-white text-indigo-600" : "bg-primary/10 text-primary")}>
                              <AudioLines className="h-4 w-4" aria-hidden />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold">{a.name}</span>
                              <span className={cn("block text-[11px]", ws.assetId === a.id ? "text-background/75" : "text-muted-foreground")}>
                                {a.durationMs ? `${Math.max(1, Math.round(a.durationMs / 1000))} s · ` : ""}
                                {a.characters.toLocaleString("en-US")} characters
                              </span>
                            </span>
                            {ws.assetId === a.id ? <Check className="h-4 w-4 shrink-0" aria-hidden /> : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-2 text-[11px] text-muted-foreground">Saved audio is reused as it is — you are not charged for the audio again, only for the lip sync.</p>
                </div>
              ) : null}

              {(cfg?.expression.enabled || cfg?.activeSpeaker.enabled) && (ws.source === "text" ? ws.text.trim().length > 0 : ws.source === "library" ? !!ws.assetId : !!ws.audio) ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {cfg?.expression.enabled ? (
                    <div>
                      <span className="text-xs font-semibold text-muted-foreground">Expression</span>
                      <div className="mt-1 grid grid-cols-3 gap-1 rounded-xl bg-secondary/60 p-1">
                        {LIP_SYNC_EXPRESSIONS.map((x) => (
                          <button key={x} type="button" onClick={() => ws.setExpression(x)} className={cn("rounded-lg px-2 py-1.5 text-xs font-semibold capitalize transition", (ws.expression ?? cfg.expression.default) === x ? "bg-background shadow-sm" : "text-muted-foreground")}>
                            {x}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {cfg?.activeSpeaker.enabled ? (
                    <label className="flex items-start gap-3 rounded-xl border border-border/70 p-3">
                      <input type="checkbox" checked={ws.activeSpeaker ?? cfg.activeSpeaker.default} onChange={(e) => ws.setActiveSpeaker(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" />
                      <span>
                        <span className="block text-sm font-semibold">Active speaker detection</span>
                        <span className="block text-[11px] leading-relaxed text-muted-foreground">More than one face? Sync the one who is speaking.</span>
                      </span>
                    </label>
                  ) : null}
                </div>
              ) : null}
            </Section>

            {/* ── Step 3 · the estimate ──────────────────────────────────── */}
            <Section n={3} title="Estimated cost">
              {!ws.inputsReady ? (
                <p className="text-sm text-muted-foreground">Add a video and {ws.source === "text" ? "the text" : "an audio file"} to see the estimate.</p>
              ) : ws.quote.status === "pending" || ws.quote.status === "idle" ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Working out the price…
                </p>
              ) : ws.quote.status === "error" ? (
                <Notice tone="error">{ws.quote.message}</Notice>
              ) : quoted ? (
                <div className="space-y-2">
                  {complimentary ? (
                    <Row label="Total" value="Free" strong />
                  ) : (
                    <>
                      {creditsCover && credits ? (
                        <>
                          <Row label="Estimated" value={`${credits.required} AI credit${credits.required === 1 ? "" : "s"}`} strong />
                          <Row label="Remaining today" value={`${credits.remainingToday} → ${credits.afterToday}`} />
                          <Row label="Remaining this week" value={`${credits.remainingThisWeek} → ${credits.afterThisWeek}`} />
                        </>
                      ) : (
                        <>
                          {/* 0184: credits only — the wallet holds credits and is charged the server's figure */}
                          <Row label="Total" value={formatCredits(quoted.quote.credits)} strong />
                          {credits?.applicable ? <Row label="AI plan allowance" value={`${credits.required} needed · ${credits.remainingToday} today · ${credits.remainingThisWeek} this week`} /> : null}
                          <Row label="Your credits" value={formatCredits(quoted.balanceCents)} />
                        </>
                      )}
                    </>
                  )}
                  {quoted.speech.mismatch ? (
                    <Notice tone="muted">
                      {quoted.speech.mismatch === "speech_longer" ? `That text would take about ${fmtSeconds(quoted.speech.estimateMs ?? 0)} to say — longer than the ${fmtSeconds(quoted.quote.durationMs)} video.` : `That text is much shorter than the video (about ${fmtSeconds(quoted.speech.estimateMs ?? 0)} of speech for ${fmtSeconds(quoted.quote.durationMs)}).`}{" "}
                      {policyWords(quoted.speech.policy)}
                    </Notice>
                  ) : null}
                  {quoted.speech.path === "tts" && ws.source === "text" ? <p className="text-[11px] text-muted-foreground">The voice is generated first, then the lips follow it.</p> : null}
                </div>
              ) : null}
            </Section>

            {/* ── Step 4 · generate ──────────────────────────────────────── */}
            <div className="space-y-3">
              {ws.launch.phase === "error" && ws.launch.code !== "CR_CREDITS_REQUIRED" ? <Notice tone="error">{ws.launch.message}</Notice> : null}
              {ws.config && !ws.config.processingAvailable ? <Notice tone="muted">{ws.config.processingUnavailableReason ?? "Processing isn't available right now."}</Notice> : null}
              {creditsShort && quoted ? (
                <button type="button" onClick={openPlans} className={aiButtonClass({ size: "lg", block: true, className: "min-h-[3.5rem]" })}>
                  <Sparkles className="h-4 w-4" aria-hidden />
                  Get more AI credits
                </button>
              ) : shortOfBalance && quoted ? (
                <Link href={`${usageHref}?recharge=${quoted.shortfallCents}`} className={aiButtonClass({ size: "lg", block: true, className: "min-h-[3.5rem]" })}>
                  Top up {formatCredits(quoted.shortfallCents)} to continue
                </Link>
              ) : (
                <button type="button" onClick={() => void ws.generate()} disabled={!canGenerate} className={aiButtonClass({ size: "lg", block: true, className: "min-h-[3.5rem]" })}>
                  {launching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}
                  {launchLabel(ws.launch, quoted, credits, complimentary, creditsCover)}
                </button>
              )}
              <p className="text-center text-[11px] leading-relaxed text-muted-foreground">Nothing is charged until processing starts. A generation that doesn&apos;t finish comes back to you.</p>
            </div>
          </AiPanel>
        ) : !ws.config && !ws.configError ? (
          /*
            §43/§60 LOADING, not nothing (2026-10-05). The form waits for the
            member's config (entitlement, own voices, launch gate), and until
            it arrived this rendered NOTHING — the page was 792px tall, then
            ~1,000px of form landed at once: CLS 0.204 on a production build.
            Four section shells at the form's own size hold the space.
          */
          <LipSyncFormLoading />
        ) : null}

        <div className="mt-8 flex justify-center gap-4 text-xs text-muted-foreground">
          <Link href={aiHref} className="underline-offset-2 hover:underline">
            AI Studio
          </Link>
          <Link href={historyHref} className="underline-offset-2 hover:underline">
            Your AI videos
          </Link>
          <Link href={usageHref} className="underline-offset-2 hover:underline">
            Credits &amp; balance
          </Link>
        </div>

        {/*
          The trust row that closes both of the owner's references. It existed
          in frenz-ai-chrome.tsx and was rendered on NO page at all — a fair
          measure of how much of the reference had been described rather than
          built.
        */}
        <FrenzAITrustRow className="mt-8 border-t border-border/60 pt-5" />
      </div>
      {plansSheet ? (
        <AiPlansSheet
          open={plansSheet}
          onClose={() => {
            setPlansSheet(false);
            ws.clearLaunchError();
          }}
          plans={plansCatalogue}
          currentPlan={credits?.plan ?? null}
          shortfall={credits && !credits.affordable ? { ...credits, walletOffered: quoted?.walletOffered !== false, priceLabel: quoted ? formatCredits(quoted.quote.credits) : null } : null}
          returnTo={basePath}
          onPayFromWallet={() => {
            ws.setFunding("wallet");
            setPlansSheet(false);
            ws.clearLaunchError();
          }}
        />
      ) : null}
    </FrenzAIEnvironment>
  );
}

/* ───────────────────────────── Step 5 · 6 ────────────────────────────────── */

const STEPS = [
  { key: "speech", label: "Preparing speech" },
  { key: "sync", label: "Synchronizing lips" },
  { key: "render", label: "Rendering video" },
  { key: "final", label: "Finalizing" },
] as const;

function stepIndex(job: AiJobView | null): number {
  if (!job) return 0;
  const status = job.status;
  if (status === "queued" || status === "acquiring" || status === "waiting") return 0;
  if (status === "processing") {
    const rec = job.lipSync?.pipeline?.records.lipsync;
    return rec === "processing" ? 2 : 1;
  }
  if (status === "finalizing") return 3;
  return 4;
}

function JobStage({ job, missing, previewUrl, onCancel, onAnother, historyHref, basePath }: { job: AiJobView | null; missing: boolean; previewUrl: string | null; onCancel: () => void; onAnother: () => void; historyHref: string; basePath: string }) {
  const [saved, setSaved] = useState(!!job?.lipSync?.savedAt);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [deleted, setDeleted] = useState(false);
  useEffect(() => setSaved(!!job?.lipSync?.savedAt), [job?.lipSync?.savedAt]);
  useEffect(() => {
    if (job?.status === "completed") track("lip_sync_result_viewed", { source: job.lipSync?.speechSource ?? null });
  }, [job?.status, job?.lipSync?.speechSource]);
  const idx = stepIndex(job);
  const ls = job?.lipSync ?? null;
  const refundLine = useMemo(() => {
    if (!ls) return null;
    if (ls.billing === "FREE_TRIAL") return ls.freeRestored ? "Your complimentary creation is back." : "This was a complimentary creation — nothing to return.";
    if (ls.billing === "CREDITS") return ls.creditsReleased ? `Your ${ls.credits ?? ""} credits are back.` : "Your credits are on their way back.";
    if (ls.chargedCents && ls.chargedCents > 0) return ls.refunded ? "Refunded to your credits." : ls.refundPending ? "The refund is on its way." : null;
    return null;
  }, [ls]);

  if (missing) return <Notice tone="error">That video isn&apos;t here any more.</Notice>;
  if (!job) return <div className="h-48 animate-pulse rounded-[1.5rem] bg-secondary/60" aria-busy="true" aria-label="Loading" />;

  if (job.status === "completed") {
    return (
      <div className="space-y-4">
        <VideoReadyPlayer src={previewUrl} poster={job.result.hasPoster ? `/api/ai/jobs/${encodeURIComponent(job.id)}/poster` : null} title="Your lip-synced video" className="overflow-hidden rounded-[1.5rem] bg-black" />
        <p className="text-sm text-muted-foreground">
          {ls?.speechSource === "audio" ? "Lips synced to your audio." : ls?.speechPath === "native" ? "Lips synced to the spoken text." : "Lips synced to the generated voice."}
          {ls?.selectedDurationMs ? ` ${fmtSeconds(ls.selectedDurationMs)}.` : ""}
          {ls?.output?.width && ls.output.height ? ` ${ls.output.width}×${ls.output.height}.` : ""}
        </p>
        {deleted ? (
          <Notice tone="muted">Deleted. It will not be in your AI videos.</Notice>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <button type="button" onClick={() => startAiResultDownload(job)} className={aiButtonClass({ size: "lg", className: "col-span-2" })}>
              <Download className="h-4 w-4" aria-hidden /> Download
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={async () => {
                setBusy("save");
                const res = await saveAiJob(job.id, !saved);
                if (res.ok) setSaved(res.saved);
                setBusy(null);
              }}
              className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full border border-border px-4 text-[13px] font-semibold disabled:opacity-50"
            >
              <Check className="h-4 w-4" aria-hidden /> {saved ? "Kept" : "Keep"}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={async () => {
                if (!window.confirm("Delete this video? This cannot be undone.")) return;
                setBusy("delete");
                const res = await deleteAiJob(job.id);
                if (res.ok && res.deleted) setDeleted(true);
                setBusy(null);
              }}
              className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full border border-border px-4 text-[13px] font-semibold text-rose-600 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" aria-hidden /> Delete
            </button>
          </div>
        )}
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href={basePath} onClick={onAnother} className="inline-flex items-center gap-1.5 font-semibold text-primary">
            <RefreshCcw className="h-4 w-4" aria-hidden /> Make another
          </Link>
          <Link href={historyHref} className="text-muted-foreground underline-offset-2 hover:underline">
            Your AI videos
          </Link>
        </div>
      </div>
    );
  }

  if (!isActiveStatus(job.status)) {
    const ended = job.status === "cancelled" ? "Stopped." : job.status === "expired" ? "This video expired." : "This one didn't finish.";
    /*
      🔴 "This one didn't finish. That job didn't finish." — the owner's
      screenshot, 2026-09-27. The lead-in above and `storedErrorMessage`'s
      fallback for an UNKNOWN code say the same thing in different words, and
      concatenating them read like a stutter. A message that adds nothing is
      dropped; a real one (a rejected file, a length mismatch) still shows.
    */
    const detail = job.error?.message && !/didn't finish/i.test(job.error.message) ? job.error.message : "";
    return (
      <div className="space-y-4">
        <Notice tone={job.status === "failed" ? "error" : "muted"}>
          {[ended, detail, refundLine ?? ""].filter(Boolean).join(" ")}
        </Notice>
        <Link href={basePath} onClick={onAnother} className={aiButtonClass({ size: "lg", block: true })}>
          <RefreshCcw className="h-4 w-4" aria-hidden /> Try again
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-[1.5rem] border border-border/70 bg-card p-5">
      <ol className="space-y-3">
        {STEPS.map((s, i) => (
          <li key={s.key} className={cn("flex items-center gap-3 text-sm", i < idx ? "text-muted-foreground" : i === idx ? "font-semibold" : "text-muted-foreground/60")}>
            <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full border", i < idx ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600" : i === idx ? "border-primary text-primary" : "border-border")}>
              {i < idx ? <Check className="h-3.5 w-3.5" aria-hidden /> : i === idx ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <span className="text-[10px]">{i + 1}</span>}
            </span>
            {s.label}
          </li>
        ))}
      </ol>
      <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">You can leave this page — we&apos;ll notify you when it&apos;s ready, and it will be in your AI videos.</p>
      <div className="mt-4 flex flex-wrap gap-3 text-sm">
        {job.status === "queued" || job.status === "acquiring" || job.status === "waiting" ? (
          <button type="button" onClick={onCancel} className="rounded-full border border-border px-4 py-2 text-xs font-semibold">
            Cancel
          </button>
        ) : null}
        <Link href={historyHref} className="self-center text-xs text-muted-foreground underline-offset-2 hover:underline">
          Your AI videos
        </Link>
      </div>
    </div>
  );
}

/* ───────────────────────────── pieces ────────────────────────────────────── */

function LipSyncFormLoading() {
  return (
    // Redesign page 7: the same ONE panel as the form, its blocks at the form's block heights (measured on the build).
    <AiPanel className="space-y-6">
      <div role="status" aria-live="polite" className="space-y-6">
        <span className="sr-only">Loading Lip Sync Pro…</span>
        {[118, 368, 188, 148].map((h, i) => (
          <div key={i} aria-hidden style={{ height: h }}>
            <div className="h-3.5 w-32 animate-pulse rounded-full bg-secondary motion-reduce:animate-none" />
          </div>
        ))}
      </div>
    </AiPanel>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    // Redesign page 7: every step lives in ONE panel; a step is a titled block with a small number, not a box of its own.
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-[15px] font-bold tracking-[-0.015em]">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-indigo-50 text-[11px] font-bold text-indigo-600 ring-1 ring-inset ring-indigo-200">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function SourceTab({ active, onClick, icon, label, hint }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; hint: string }) {
  return (
    // Redesign page 7 (Brief A, selected controls): a clear border and a subtle tint — not an inverted black block; one line each so nothing wraps at 390 px.
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        // stacked: the icon above the words, so the label gets the tile's full width (side by side it truncated at 390 px)
        "flex min-h-[86px] flex-col items-start gap-1.5 rounded-2xl px-3 py-2.5 text-left ring-inset transition active:scale-[0.98]",
        active ? "bg-indigo-50/80 ring-2 ring-indigo-400/80" : "bg-card ring-1 ring-black/[0.08] [@media(hover:hover)]:hover:ring-indigo-300/60",
      )}
    >
      <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-xl", active ? "bg-white text-indigo-600 shadow-[0_2px_6px_-2px_rgba(99,102,241,0.5)]" : "bg-indigo-50 text-indigo-600")}>{icon}</span>
      <span className="w-full min-w-0">
        <span className={cn("block truncate text-[13.5px] font-semibold", active && "text-indigo-900")}>{label}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 text-sm", strong ? "font-bold" : "text-muted-foreground")}>
      <span>{label}</span>
      <span className="tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function Notice({ tone, children }: { tone: "error" | "muted"; children: React.ReactNode }) {
  return <p className={cn("rounded-2xl px-4 py-3 text-sm leading-relaxed", tone === "error" ? "bg-rose-500/10 text-rose-700 dark:text-rose-300" : "bg-secondary/70 text-muted-foreground")}>{children}</p>;
}

function launchLabel(launch: LaunchPhase, quoted: { quote: { credits: number } } | null, credits: { required: number } | null, complimentary: boolean, creditsCover: boolean): string {
  if (launch.phase === "creating") return "Opening…";
  if (launch.phase === "uploading") return `Uploading ${Math.round(launch.progress * 100)}%`;
  if (launch.phase === "starting") return "Starting…";
  if (!quoted) return "Generate Lip Sync";
  if (complimentary) return "Generate Lip Sync · Free";
  if (creditsCover && credits) return `Generate Lip Sync · ${credits.required} credit${credits.required === 1 ? "" : "s"}`;
  return `Generate Lip Sync · ${formatCredits(quoted.quote.credits)}`;
}

function policyWords(policy: string): string {
  switch (policy) {
    case "trim_video_to_audio":
      return "The video will be shortened to the speech.";
    case "trim_audio_to_video":
      return "The speech will be cut to the video's length.";
    case "loop_audio":
      return "The speech will loop to fill the video.";
    case "reject":
      return "A big difference will be refused before anything is charged.";
    default:
      return "The rest of the video stays quiet.";
  }
}

function fmtSeconds(ms: number): string {
  const s = ms / 1000;
  return `${s % 1 ? s.toFixed(1) : s} s`;
}
function fmtClock(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

