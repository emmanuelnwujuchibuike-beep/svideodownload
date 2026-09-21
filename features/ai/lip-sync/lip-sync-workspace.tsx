"use client";

import { AudioLines, Check, Download, FileAudio, Loader2, Mic, RefreshCcw, Sparkles, Trash2, Type, Upload } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CharacterReplaceMediaPicker } from "@/features/ai/character-replace/media-picker";
import { VideoReadyPlayer } from "@/features/ai/character-replace/video-ready-player";
import { startAiResultDownload } from "@/features/ai/ai-result-download";
import { FrenzAIEnvironment } from "@/features/ai/core/frenz-ai-environment";
import { AiPlansSheet } from "@/features/ai/credits/ai-plans-sheet";
import { useLipSyncWorkspace, type LaunchPhase } from "@/features/ai/lip-sync/use-lip-sync-workspace";
import { track } from "@/lib/analytics/client";
import { deleteAiJob, saveAiJob } from "@/lib/ai/client";
import { getAiCredits } from "@/lib/ai/credits/client";
import type { AiPlansPublic } from "@/lib/ai/credits/config";
import { formatCents } from "@/lib/ai/economy";
import { isActiveStatus, type AiJobView } from "@/lib/ai/jobs";
import { LIP_SYNC_EXPRESSIONS } from "@/lib/ai/lip-sync/config";
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
export function LipSyncWorkspace({ basePath, aiHref, historyHref, usageHref, initialJobId = null }: { basePath: string; aiHref: string; historyHref: string; usageHref: string; initialJobId?: string | null }) {
  const ws = useLipSyncWorkspace({ initialJobId });
  const cfg = ws.config?.config ?? null;
  const symbol = cfg?.symbol ?? "$";
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
        <header className="mb-5">
          <p className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
            Frenz AI · Lip Sync Pro
          </p>
          <h1 className="mt-2 text-[1.9rem] font-bold leading-[1.06] tracking-[-0.04em] sm:text-[2.3rem]">
            {watching ? (job?.status === "completed" ? "Your video is " : "Syncing the ") : "Make them say "}
            <span className="text-gradient">{watching ? (job?.status === "completed" ? "ready." : "lips.") : "anything."}</span>
          </h1>
          {!watching ? <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">Type what they should say, or bring your own audio. The mouth follows the speech; the face, the body and the scene stay theirs.</p> : null}
        </header>

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
          <div className="space-y-5">
            {/* ── Step 1 · the video ─────────────────────────────────────── */}
            <Section n={1} title="Upload video">
              {ws.video ? (
                <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card p-3">
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
                  <div className="grid gap-3 sm:grid-cols-2">
                    {cfg.capabilities.supports_voice_selection && cfg.voices.length ? (
                      <label className="block">
                        <span className="text-xs font-semibold text-muted-foreground">Voice</span>
                        <select value={ws.voiceId ?? ""} onChange={(e) => ws.setVoiceId(e.target.value || null)} className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm">
                          <option value="">Default voice</option>
                          {cfg.voices.filter((v) => !ws.languageCode || !v.languages.length || v.languages.includes(ws.languageCode)).map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.label}
                              {v.blurb ? ` — ${v.blurb}` : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {cfg.capabilities.supports_language && cfg.languages.length ? (
                      <label className="block">
                        <span className="text-xs font-semibold text-muted-foreground">Language</span>
                        <select value={ws.languageCode ?? ""} onChange={(e) => ws.setLanguageCode(e.target.value || null)} className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm">
                          <option value="">Auto</option>
                          {cfg.languages.map((l) => (
                            <option key={l.code} value={l.code}>
                              {l.label}
                              {l.native && l.native !== l.label ? ` · ${l.native}` : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </div>
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
                    <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card p-3">
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

              {(cfg?.expression.enabled || cfg?.activeSpeaker.enabled) && (ws.source === "audio" ? !!ws.audio : ws.text.trim().length > 0) ? (
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
                          {quoted.quote.lines.map((l) => (
                            <Row key={l.key} label={l.label} value={formatCents(l.amountCents, symbol)} />
                          ))}
                          <Row label="Total" value={formatCents(quoted.quote.totalCents, symbol)} strong />
                          {credits?.applicable ? <Row label="In AI credits" value={`${credits.required} needed · ${credits.remainingToday} today · ${credits.remainingThisWeek} this week`} /> : null}
                          <Row label="Your balance" value={formatCents(quoted.balanceCents, symbol)} />
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
                <button type="button" onClick={openPlans} className="ai-cta inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-full bg-foreground px-6 text-[15px] font-bold text-background">
                  <Sparkles className="h-4 w-4" aria-hidden />
                  Get more AI credits
                </button>
              ) : shortOfBalance && quoted ? (
                <Link href={`${usageHref}?recharge=${quoted.shortfallCents}`} className="ai-cta inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-full bg-foreground px-6 text-[15px] font-bold text-background">
                  Add {formatCents(quoted.shortfallCents, symbol)} to continue
                </Link>
              ) : (
                <button type="button" onClick={() => void ws.generate()} disabled={!canGenerate} className="ai-cta inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-full bg-foreground px-6 text-[15px] font-bold text-background transition disabled:cursor-not-allowed disabled:opacity-45">
                  {launching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}
                  {launchLabel(ws.launch, quoted, credits, complimentary, symbol, creditsCover)}
                </button>
              )}
              <p className="text-center text-[11px] leading-relaxed text-muted-foreground">Nothing is charged until processing starts. A generation that doesn&apos;t finish comes back to you.</p>
            </div>
          </div>
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
          shortfall={credits && !credits.affordable ? { ...credits, walletOffered: quoted?.walletOffered !== false, priceLabel: quoted ? formatCents(quoted.quote.totalCents, symbol) : null } : null}
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
    if (ls.chargedCents && ls.chargedCents > 0) return ls.refunded ? "Refunded to your balance." : ls.refundPending ? "The refund is on its way." : null;
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
            <button type="button" onClick={() => startAiResultDownload(job)} className="ai-cta col-span-2 inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full bg-foreground px-5 text-[14px] font-bold text-background sm:col-span-2">
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
    return (
      <div className="space-y-4">
        <Notice tone={job.status === "failed" ? "error" : "muted"}>
          {ended} {job.error?.message ?? ""} {refundLine ?? ""}
        </Notice>
        <Link href={basePath} onClick={onAnother} className="ai-cta inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 text-[14px] font-bold text-background">
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

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[1.5rem] border border-border/70 bg-card/60 p-4 sm:p-5">
      <h2 className="mb-3 flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-foreground text-[11px] font-bold text-background">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function SourceTab({ active, onClick, icon, label, hint }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; hint: string }) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick} className={cn("flex min-h-[64px] items-center gap-3 rounded-2xl border px-3 py-2 text-left transition", active ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-secondary/40")}>
      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", active ? "bg-background/15" : "bg-primary/10 text-primary")}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className={cn("block text-[11px]", active ? "text-background/75" : "text-muted-foreground")}>{hint}</span>
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

function launchLabel(launch: LaunchPhase, quoted: { quote: { totalCents: number } } | null, credits: { required: number } | null, complimentary: boolean, symbol: string, creditsCover: boolean): string {
  if (launch.phase === "creating") return "Opening…";
  if (launch.phase === "uploading") return `Uploading ${Math.round(launch.progress * 100)}%`;
  if (launch.phase === "starting") return "Starting…";
  if (!quoted) return "Generate Lip Sync";
  if (complimentary) return "Generate Lip Sync · Free";
  if (creditsCover && credits) return `Generate Lip Sync · ${credits.required} credit${credits.required === 1 ? "" : "s"}`;
  return `Generate Lip Sync · ${formatCents(quoted.quote.totalCents, symbol)}`;
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

