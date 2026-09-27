"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useJobWatch } from "@/features/ai/core/use-job-watch";
import { newClientRequestId } from "@/lib/ai/client";
import {
  createVoiceCloneDraft,
  getVoiceCloneConfig,
  measureAudioDuration,
  startVoiceClone,
  uploadVoiceSample,
  type VcConfigAnswer,
} from "@/lib/ai/voice-clone/client";
import { EMPTY_VOICE_CLONE_LABELS, type VoiceCloneLabels } from "@/lib/ai/voice-clone/labels";
import { track } from "@/lib/analytics/client";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE VOICE CLONING WORKSPACE — its state, and nothing else's
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A standalone tool: recordings in, a voice out. No video is read and no other
 * tool's state is touched, which is also what keeps this hook small enough to
 * leave the page responsive (the owner's standing rule: the AI features must
 * never break page navigation or button responsiveness).
 *
 * The shape is create → upload → start, because the samples are files and the
 * bytes go straight to storage:
 *
 *   pick     the files, measured in the browser for the "how much have I given
 *            you" hint. Nothing has happened on the server yet.
 *   make     one request opens the draft and returns one ticket per sample;
 *            each file is PUT in turn with its own progress; then /start
 *            carries the consent and the money.
 *
 * ── 🔴 THE CONSENT IS STATE, NOT A SUBMIT-TIME LOOK-UP ──────────────────────
 * `agreed` and `consentName` are held here and sent explicitly. The server
 * refuses a body without them, so this is the interface agreeing with the
 * server rather than the only thing standing between a member and a clone.
 */
export type VcPhase =
  | { phase: "idle" }
  | { phase: "uploading"; done: number; total: number }
  | { phase: "starting" }
  | { phase: "error"; code: string; message: string; extra?: Record<string, unknown> };

export interface PickedSample {
  file: File;
  durationMs: number | null;
  /** Local only, so a member can see which one is which before it is sent. */
  key: string;
}

export function useVoiceCloning(opts: { initialJobId?: string | null }) {
  const [config, setConfig] = useState<VcConfigAnswer | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  /*
    2026-09-27: the four the vendor's own clone form asks for. They describe the
    voice on the account and in the library; the accent itself still comes from
    the recordings (lib/ai/voice-clone/labels.ts).
  */
  const [labels, setLabels] = useState<VoiceCloneLabels>(EMPTY_VOICE_CLONE_LABELS);
  const setLabel = useCallback((key: keyof VoiceCloneLabels, value: string | null) => setLabels((l) => ({ ...l, [key]: value })), []);
  const [samples, setSamples] = useState<PickedSample[]>([]);
  /** What the picker refused, said where the member is looking rather than after an upload. */
  const [pickError, setPickError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [consentName, setConsentName] = useState("");
  const [funding, setFunding] = useState<"credits" | "wallet" | null>(null);
  const [state, setState] = useState<VcPhase>({ phase: "idle" });
  const [jobId, setJobId] = useState<string | null>(opts.initialJobId ?? null);
  const requestId = useRef<string | null>(null);
  const watch = useJobWatch(jobId);

  const loadConfig = useCallback(async () => {
    const res = await getVoiceCloneConfig();
    if (res.ok) {
      setConfig(res);
      setConfigError(null);
    } else setConfigError(res.error);
  }, []);
  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const limits = config?.config.samples ?? null;
  const totalBytes = samples.reduce((a, s) => a + s.file.size, 0);
  const measuredSeconds = samples.reduce((a, s) => a + (s.durationMs ?? 0), 0) / 1000;
  /* only files whose length the browser could read count toward the minimum — an undecodable file must not be held against the member */
  const measurable = samples.some((s) => s.durationMs !== null);
  const tooLittle = !!limits && measurable && measuredSeconds > 0 && measuredSeconds < limits.minimumSecondsTotal;
  const tooMuch = !!limits && totalBytes > limits.maximumTotalBytes;
  const enough = !!limits && samples.length >= limits.minimum && samples.length <= limits.maximum;

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const max = limits?.maximum ?? 5;
      const all = Array.from(files);
      /*
        🔴 A LAST GUARD IN THE BROWSER (2026-09-27). `accept` is a HINT — every
        OS picker has a "show all files" escape, and some ignore it outright. A
        video chosen here would travel all the way to the server to be refused,
        after the member had already watched it upload. The server refuses it
        too (`voiceCloneFormatAllowed`); this is the half that is kind about it.
      */
      const rejected = all.filter((f) => f.type.startsWith("video/") || f.type.startsWith("image/"));
      if (rejected.length > 0) setPickError(rejected.length === all.length ? "Those are not audio files. Choose a recording — MP3, WAV, M4A and the rest." : "Some of those were not audio files, so they were left out.");
      else setPickError(null);
      const incoming = all.filter((f) => !rejected.includes(f)).slice(0, Math.max(0, max - samples.length));
      const measured = await Promise.all(
        incoming.map(async (file) => ({ file, durationMs: await measureAudioDuration(file), key: `${file.name}:${file.size}:${file.lastModified}` })),
      );
      // the same file twice is a member clicking twice, not two samples
      setSamples((prev) => [...prev, ...measured.filter((m) => !prev.some((p) => p.key === m.key))]);
    },
    [limits?.maximum, samples.length],
  );

  const removeSample = useCallback((key: string) => setSamples((prev) => prev.filter((s) => s.key !== key)), []);

  const ready = enough && !tooMuch && !tooLittle && name.trim().length > 0 && agreed && (!config?.config.requireConsentName || consentName.trim().length >= 2) && (config?.available ?? false);

  const create = useCallback(async () => {
    if (!ready || !config) return;
    setState({ phase: "uploading", done: 0, total: samples.length });
    track("voice_clone_started", { samples: samples.length });
    if (!requestId.current) requestId.current = newClientRequestId();
    const draft = await createVoiceCloneDraft({
      clientRequestId: requestId.current,
      name: name.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      samples: samples.map((s) => ({ name: s.file.name, mimeType: s.file.type || "audio/mpeg", size: s.file.size, durationMs: s.durationMs })),
      labels,
    });
    if (!draft.ok) {
      setState({ phase: "error", code: draft.code, message: draft.error, extra: draft.extra });
      return;
    }
    /* the files, in order, each with its own ticket. One failure stops the run — a half-uploaded voice is not a voice. */
    for (let i = 0; i < draft.uploads.length; i++) {
      const ticket = draft.uploads[i]!;
      const sample = samples[i];
      if (!sample) continue;
      const put = await uploadVoiceSample(ticket, sample.file);
      if (!put.ok) {
        setState({ phase: "error", code: "STORAGE_ERROR", message: put.error });
        return;
      }
      setState({ phase: "uploading", done: i + 1, total: draft.uploads.length });
    }
    setState({ phase: "starting" });
    const started = await startVoiceClone(draft.job.id, {
      consent: true,
      ...(consentName.trim() ? { consentName: consentName.trim() } : {}),
      ...(config.quote ? { quote: { totalCents: config.quote.totalCents, pricingConfigVersion: config.quote.pricingConfigVersion } } : {}),
      ...(funding ? { funding } : {}),
    });
    if (!started.ok) {
      setState({ phase: "error", code: started.code, message: started.error, extra: started.extra });
      // the price or the allowance moved: read the fresh figures before the next press
      if (started.code === "PRICE_CHANGED" || started.code === "CR_CREDITS_UNAVAILABLE" || started.code === "VOICE_CLONE_LIMIT") void loadConfig();
      return;
    }
    requestId.current = null;
    setState({ phase: "idle" });
    setJobId(started.job.id);
  }, [ready, config, samples, name, description, labels, consentName, funding, loadConfig]);

  const reset = useCallback(() => {
    setJobId(null);
    setState({ phase: "idle" });
    requestId.current = null;
    setSamples([]);
    setName("");
    setDescription("");
    setLabels(EMPTY_VOICE_CLONE_LABELS);
    setAgreed(false);
    setConsentName("");
    setFunding(null);
    void loadConfig();
  }, [loadConfig]);

  const clearError = useCallback(() => setState((s) => (s.phase === "error" ? { phase: "idle" } : s)), []);

  return {
    config,
    configError,
    reloadConfig: loadConfig,
    name,
    setName,
    description,
    setDescription,
    labels,
    setLabel,
    samples,
    addFiles,
    removeSample,
    pickError,
    totalBytes,
    measuredSeconds,
    measurable,
    tooLittle,
    tooMuch,
    enough,
    agreed,
    setAgreed,
    consentName,
    setConsentName,
    funding,
    setFunding,
    ready,
    state,
    clearError,
    create,
    jobId,
    watch,
    reset,
  };
}
