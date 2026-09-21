"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { readAudioDuration, readVideoMetadata } from "@/features/ai/character-replace/read-media";
import { useJobWatch } from "@/features/ai/character-replace/use-job-watch";
import { track } from "@/lib/analytics/client";
import { newClientRequestId, uploadSource } from "@/lib/ai/client";
import { createLipSyncJob, getLipSyncConfig, getLipSyncQuote, quoteFieldsForStart, startLipSyncJob, type LipSyncConfigAnswer, type LipSyncQuoteAnswer } from "@/lib/ai/lip-sync/client";
import type { LipSyncExpression } from "@/lib/ai/lip-sync/config";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE LIP SYNC PRO WORKSPACE'S STATE (§14) — one hook, the server decides
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   video    the member's file, measured in the browser (the worker measures
 *            again); a clip longer than the ceiling keeps a window of it
 *            (the trim), never a silent cut
 *   speech   EXACTLY ONE source: typed text (voice · language · speed) or an
 *            audio file — switching sources clears the other (§3)
 *   quote    asked from the server whenever the priced inputs change; the
 *            credits, the remaining allowance, the balance, whether it is
 *            complimentary — never computed here
 *   launch   create → upload (measured progress) → start → the job's own
 *            poll (use-job-watch) until it ends
 */
export type SpeechSource = "text" | "audio";

export interface LipSyncVideo {
  file: File;
  objectUrl: string;
  durationMs: number;
  width: number;
  height: number;
  hasAudio: boolean | null;
}
export interface LipSyncAudio {
  file: File;
  objectUrl: string;
  durationMs: number | null;
}

export type LaunchPhase = { phase: "idle" } | { phase: "creating" } | { phase: "uploading"; progress: number } | { phase: "starting" } | { phase: "error"; code: string; message: string; extra?: Record<string, unknown> };

export function useLipSyncWorkspace(opts: { initialJobId?: string | null }) {
  const [config, setConfig] = useState<LipSyncConfigAnswer | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [video, setVideo] = useState<LipSyncVideo | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [trimStartMs, setTrimStartMs] = useState(0);
  const [source, setSourceState] = useState<SpeechSource>("text");
  const [text, setText] = useState("");
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [languageCode, setLanguageCode] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const [audio, setAudio] = useState<LipSyncAudio | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [expression, setExpression] = useState<LipSyncExpression | null>(null);
  const [activeSpeaker, setActiveSpeaker] = useState<boolean | null>(null);
  const [quote, setQuote] = useState<{ status: "idle" } | { status: "pending" } | { status: "quoted"; answer: LipSyncQuoteAnswer } | { status: "error"; code: string; message: string; extra?: Record<string, unknown> }>({ status: "idle" });
  const [funding, setFunding] = useState<"credits" | "wallet" | null>(null);
  const [launch, setLaunch] = useState<LaunchPhase>({ phase: "idle" });
  const [jobId, setJobId] = useState<string | null>(opts.initialJobId ?? null);
  const requestId = useRef<string | null>(null);
  const quoteAbort = useRef<AbortController | null>(null);
  const watch = useJobWatch(jobId);

  /* ── the configuration ─────────────────────────────────────────────────── */
  const loadConfig = useCallback(async () => {
    const res = await getLipSyncConfig();
    if (res.ok) {
      setConfig(res);
      setConfigError(null);
      setSourceState((s) => (s === "text" && !res.config.textMode.enabled && res.config.audioMode.enabled ? "audio" : s === "audio" && !res.config.audioMode.enabled && res.config.textMode.enabled ? "text" : s));
      setSpeed((v) => Math.min(res.config.textMode.speed.max, Math.max(res.config.textMode.speed.min, v === 1 ? res.config.textMode.speed.default : v)));
    } else setConfigError(res.error);
  }, []);
  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  /* ── the video ─────────────────────────────────────────────────────────── */
  const pickVideo = useCallback(
    async (file: File) => {
      setVideoError(null);
      const url = URL.createObjectURL(file);
      const meta = await readVideoMetadata(url, { name: file.name, size: file.size, type: file.type });
      if (meta === "invalid" || !meta.durationMs || !meta.width || !meta.height) {
        URL.revokeObjectURL(url);
        setVideoError("That file couldn't be read as a video. Try an MP4 or MOV.");
        return;
      }
      const limits = config?.config.video;
      if (limits && file.size > limits.maximumUploadBytes) {
        URL.revokeObjectURL(url);
        setVideoError(`That video is too large (up to ${Math.round(limits.maximumUploadBytes / (1024 * 1024))} MB).`);
        return;
      }
      if (limits && meta.durationMs < limits.minimumDurationSeconds * 1000) {
        URL.revokeObjectURL(url);
        setVideoError(`Videos need at least ${limits.minimumDurationSeconds} second${limits.minimumDurationSeconds === 1 ? "" : "s"} here.`);
        return;
      }
      setVideo((prev) => {
        if (prev) URL.revokeObjectURL(prev.objectUrl);
        return { file, objectUrl: url, durationMs: meta.durationMs!, width: meta.width!, height: meta.height!, hasAudio: meta.hasAudio ?? null };
      });
      setTrimStartMs(0);
      setJobId(null);
      setLaunch({ phase: "idle" });
    },
    [config],
  );
  const clearVideo = useCallback(() => {
    setVideo((prev) => {
      if (prev) URL.revokeObjectURL(prev.objectUrl);
      return null;
    });
    setQuote({ status: "idle" });
  }, []);

  /* ── the speech source (§3: one or the other) ──────────────────────────── */
  const setSource = useCallback((next: SpeechSource) => {
    setSourceState(next);
    setQuote({ status: "idle" });
  }, []);
  const pickAudio = useCallback(
    async (file: File) => {
      setAudioError(null);
      const limits = config?.config.audioMode;
      if (limits && file.size > limits.maximumUploadBytes) {
        setAudioError(`That audio file is too large (up to ${Math.round(limits.maximumUploadBytes / (1024 * 1024))} MB).`);
        return;
      }
      const url = URL.createObjectURL(file);
      const duration = await readAudioDuration(url);
      if (duration === "invalid") {
        URL.revokeObjectURL(url);
        setAudioError("That file couldn't be read as audio. Try an MP3, WAV, M4A, AAC or OGG.");
        return;
      }
      if (limits && duration && duration > limits.maximumDurationSeconds * 1000) {
        URL.revokeObjectURL(url);
        setAudioError(`Audio can be up to ${limits.maximumDurationSeconds} seconds.`);
        return;
      }
      setAudio((prev) => {
        if (prev) URL.revokeObjectURL(prev.objectUrl);
        return { file, objectUrl: url, durationMs: duration ?? null };
      });
    },
    [config],
  );
  const clearAudio = useCallback(() => {
    setAudio((prev) => {
      if (prev) URL.revokeObjectURL(prev.objectUrl);
      return null;
    });
  }, []);

  /* ── the kept window ───────────────────────────────────────────────────── */
  const maxMs = (config?.config.video.maximumDurationSeconds ?? 60) * 1000;
  const trim = useMemo(() => {
    if (!video) return null;
    if (video.durationMs <= maxMs) return null;
    const start = Math.max(0, Math.min(video.durationMs - maxMs, trimStartMs));
    return { startMs: Math.round(start), endMs: Math.round(start + maxMs) };
  }, [video, maxMs, trimStartMs]);
  const selectedMs = video ? (trim ? trim.endMs - trim.startMs : video.durationMs) : 0;

  /* ── the estimate, from the server (§14 step 3) ────────────────────────── */
  const textReady = source === "text" && text.trim().length >= (config?.config.textMode.minimumCharacters ?? 1);
  const audioReady = source === "audio" && !!audio;
  const inputsReady = !!video && (textReady || audioReady);
  useEffect(() => {
    if (!inputsReady || !config?.config.enabled) {
      setQuote({ status: "idle" });
      return;
    }
    quoteAbort.current?.abort();
    const controller = new AbortController();
    quoteAbort.current = controller;
    setQuote({ status: "pending" });
    const timer = window.setTimeout(async () => {
      const res = await getLipSyncQuote({ selectedDurationMs: selectedMs, speechSource: source, textCharacters: source === "text" ? text.trim().length : undefined, speed: source === "text" ? speed : undefined }, controller.signal);
      if (controller.signal.aborted) return;
      if (res.ok) setQuote({ status: "quoted", answer: res });
      else if (res.code !== "NETWORK" || !controller.signal.aborted) setQuote({ status: "error", code: res.code, message: res.error, extra: res.extra });
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [inputsReady, config?.config.enabled, selectedMs, source, text, speed]);

  /* ── generate (§14 step 4): create → upload → start ────────────────────── */
  const generate = useCallback(async () => {
    if (!video || quote.status !== "quoted" || !config) return;
    const answer = quote.answer;
    setLaunch({ phase: "creating" });
    track("lip_sync_generate_clicked", { source, durationMs: selectedMs });
    if (!requestId.current) requestId.current = newClientRequestId();
    const created = await createLipSyncJob({
      clientRequestId: requestId.current,
      video: { name: video.file.name, mimeType: video.file.type || "video/mp4", size: video.file.size, durationMs: video.durationMs, width: video.width, height: video.height, hasAudio: video.hasAudio },
      speech: source === "text" ? { source: "text", text: text.trim(), voiceId, languageCode, speed } : { source: "audio", audio: { name: audio!.file.name, mimeType: audio!.file.type || "audio/mpeg", size: audio!.file.size, durationMs: audio!.durationMs } },
      settings: { expression: config.config.expression.enabled ? (expression ?? config.config.expression.default) : null, activeSpeaker: config.config.activeSpeaker.enabled ? (activeSpeaker ?? config.config.activeSpeaker.default) : false },
    });
    if (!created.ok) {
      setLaunch({ phase: "error", code: created.code, message: created.error, extra: created.extra });
      return;
    }
    const id = created.job.id;
    if (created.uploads) {
      setLaunch({ phase: "uploading", progress: 0 });
      const parts: { file: File; ticket: { path: string; uploadUrl: string; expiresIn: number } }[] = [{ file: video.file, ticket: created.uploads.video }];
      if (source === "audio" && audio && created.uploads.audio) parts.push({ file: audio.file, ticket: created.uploads.audio });
      const total = parts.reduce((a, p) => a + p.file.size, 0);
      let done = 0;
      for (const part of parts) {
        const ok = await uploadSource({ ticket: part.ticket, file: part.file, onProgress: (f) => setLaunch({ phase: "uploading", progress: total ? (done + f * part.file.size) / total : f }) });
        if (!ok) {
          setLaunch({ phase: "error", code: "UPLOAD_FAILED", message: "The upload didn't finish. Check your connection and try again — nothing was charged." });
          return;
        }
        done += part.file.size;
      }
    }
    setLaunch({ phase: "starting" });
    const started = await startLipSyncJob(id, { quote: quoteFieldsForStart(answer.quote), trim, consent: true, ...(funding ? { funding } : {}) });
    if (!started.ok) {
      setLaunch({ phase: "error", code: started.code, message: started.error, extra: started.extra });
      // a moved price or allowance: read the estimate again
      if (started.code === "PRICE_CHANGED" || started.code === "CR_CREDITS_UNAVAILABLE" || started.code === "CR_FREE_UNAVAILABLE" || started.code === "QUOTE_EXPIRED") setQuote({ status: "idle" });
      return;
    }
    requestId.current = null;
    setLaunch({ phase: "idle" });
    setJobId(id);
  }, [video, quote, config, source, selectedMs, text, voiceId, languageCode, speed, audio, expression, activeSpeaker, trim, funding]);

  const reset = useCallback(() => {
    setJobId(null);
    setLaunch({ phase: "idle" });
    requestId.current = null;
    setQuote({ status: "idle" });
    setFunding(null);
  }, []);

  const clearLaunchError = useCallback(() => setLaunch((l) => (l.phase === "error" ? { phase: "idle" } : l)), []);

  return {
    config,
    configError,
    reloadConfig: loadConfig,
    video,
    videoError,
    pickVideo,
    clearVideo,
    trim,
    trimStartMs,
    setTrimStartMs,
    selectedMs,
    maxMs,
    source,
    setSource,
    text,
    setText,
    voiceId,
    setVoiceId,
    languageCode,
    setLanguageCode,
    speed,
    setSpeed,
    audio,
    audioError,
    pickAudio,
    clearAudio,
    expression,
    setExpression,
    activeSpeaker,
    setActiveSpeaker,
    quote,
    funding,
    setFunding,
    inputsReady,
    launch,
    clearLaunchError,
    generate,
    jobId,
    watch,
    reset,
  };
}
