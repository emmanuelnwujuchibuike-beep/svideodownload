"use client";

import { useCallback, useRef, useState } from "react";

import { useCachedView } from "@/features/ai/core/use-cached-view";
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
import { extractAudioAsWav, looksLikeVideo, NoUsableAudioError } from "@/lib/media/extract-audio";
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
  /** The sound was taken out of a video (gallery) — the provider is asked to remove background noise. */
  fromVideo?: boolean;
  /** Local only, so a member can see which one is which before it is sent. */
  key: string;
}

export function useVoiceCloning(opts: { initialJobId?: string | null }) {
  /* Remembered on the device — see features/ai/core/use-cached-view.ts. */
  const configView = useCachedView<VcConfigAnswer>("voice-clone-config", async () => {
    const res = await getVoiceCloneConfig();
    return res.ok ? { ok: true as const, value: res } : { ok: false as const, error: res.error };
  });
  const config = configView.data;
  const configError = configView.error;
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
  /** How many videos are having their sound taken out right now. */
  const [extracting, setExtracting] = useState(0);
  const [agreed, setAgreed] = useState(false);
  const [consentName, setConsentName] = useState("");
  const [funding, setFunding] = useState<"credits" | "wallet" | null>(null);
  const [state, setState] = useState<VcPhase>({ phase: "idle" });
  const [jobId, setJobId] = useState<string | null>(opts.initialJobId ?? null);
  const requestId = useRef<string | null>(null);
  const watch = useJobWatch(jobId);

  const loadConfig = configView.refresh;

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
        🔴 VIDEOS ARE VOICES TOO (owner, 2026-10-08: "uploading a file is
        showing those are not files even when they are" … "it should be able to
        clone from a video from gallery, it should be clean").

        A phone's gallery offers photos and videos only, so a voice recorded on
        camera arrived as video/mp4 or video/quicktime — and so did some apps'
        audio-only .m4a — and this guard refused all of it as "not audio
        files". Now a video's SOUND is taken out here, in the browser
        (lib/media/extract-audio.ts → a small mono WAV), and the sample is
        marked so the provider removes background noise. Images are still
        refused: there is no voice in a photo.
      */
      const images = all.filter((f) => f.type.startsWith("image/"));
      const usable = all.filter((f) => !images.includes(f)).slice(0, Math.max(0, max - samples.length));
      const videos = usable.filter((f) => looksLikeVideo(f));
      const notes: string[] = [];
      if (images.length > 0) notes.push(images.length === all.length ? "Photos have no voice in them. Choose a recording or a video." : "Photos were left out — they have no voice in them.");

      setExtracting((n) => n + videos.length);
      const measured = (
        await Promise.all(
          usable.map(async (file): Promise<PickedSample | null> => {
            const key = `${file.name}:${file.size}:${file.lastModified}`;
            if (!looksLikeVideo(file)) return { file, durationMs: await measureAudioDuration(file), key };
            try {
              const out = await extractAudioAsWav(file, { maxSeconds: limits?.maximumSecondsEach ?? 300 });
              return { file: out.file, durationMs: out.durationMs, key, fromVideo: true };
            } catch (e) {
              notes.push(e instanceof NoUsableAudioError && e.message === "too large" ? `"${file.name}" is too long to use here — trim it to a few minutes.` : `We couldn't hear a voice in "${file.name}". Try another video or a recording.`);
              return null;
            } finally {
              setExtracting((n) => n - 1);
            }
          }),
        )
      ).filter((m): m is PickedSample => m !== null);
      setPickError(notes.length ? notes.join(" ") : null);
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
      samples: samples.map((s) => ({ name: s.file.name, mimeType: s.file.type || "audio/mpeg", size: s.file.size, durationMs: s.durationMs, ...(s.fromVideo ? { fromVideo: true } : {}) })),
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
    extracting: extracting > 0,
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
