import type { CharacterReplacePublicConfig } from "@/lib/ai/character-replace/config";
import { REPLACEMENT_MODE_COPY, type ReplacementMode } from "@/lib/ai/character-replace/modes";
import type { CharacterReplaceAnyQuality, CharacterReplaceVoiceSource } from "@/lib/ai/character-replace/pricing";
import type {
  AssetSlot,
  AudioAsset,
  CharacterAsset,
  CharacterReplaceProject,
  PricingLine,
  PricingState,
  SourceVideo,
  VoiceSettings,
} from "@/lib/ai/character-replace/types";
import { inputReadiness, selectedRangeMs } from "@/lib/ai/character-replace/validate";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CHARACTER REPLACE — the workspace's state, as a pure reducer
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every decision the workspace makes about its own draft lives here, with no
 * React and no DOM, so the whole flow — which step may be entered, what the
 * selected duration is, whether Start may be pressed — is testable without a
 * browser. The hook (features/ai/character-replace/use-character-replace-
 * workspace.ts) owns the side effects: decoding files, fetching the config
 * and the balance, revoking object URLs.
 *
 * ── The steps, in the owner's order ──────────────────────────────────────────
 *
 *   photo → video → settings → voice → review
 *
 * The REPLACEMENT MODE (Part 6) is chosen on the first step, above the
 * reference picker, because it decides what that picker asks for: one clear
 * face, one to three identity photos, or a full-body photo. "Price",
 * "Confirm" and "Start" are the review step: the price, the balance, the
 * consent line and the one button live together on the screen where a
 * member decides, because separating a price from the button that spends
 * it is how people get surprised.
 *
 * ── 🔴 TWO SLOTS, ONE INVARIANT (Part 2, §20) ───────────────────────────────
 *
 * Each picker has a slot — empty / validating / uploading / ready / invalid /
 * error — and the asset on the project is non-null EXACTLY when its slot is
 * `ready` or `uploading`. The reducer is the only writer of both, and every
 * transition sets them together, so "video ready" with no file, or a trim on
 * a video that was removed, cannot be represented. Replacing a file runs the
 * same clear as removing it first: the old metadata, trim and preview are
 * gone before the new file's facts arrive. Part 6's audio slot follows the
 * same rule.
 */

export type WorkspaceStep = "photo" | "video" | "settings" | "voice" | "review";

export const WORKSPACE_STEPS: readonly { id: WorkspaceStep; label: string; title: string }[] = [
  /*
    Part 9 §3: the member's words, not ours. "Reference" and "Settings" were
    the engineering names; a first-time user reads Character → Video →
    Quality → Voice → Review and knows where they are.
  */
  { id: "photo", label: "Character", title: "Your character" },
  { id: "video", label: "Video", title: "Your video" },
  { id: "settings", label: "Quality", title: "Quality & trim" },
  { id: "voice", label: "Voice", title: "Audio & voice" },
  { id: "review", label: "Review", title: "Review & create" },
] as const;

export function stepIndex(step: WorkspaceStep): number {
  return WORKSPACE_STEPS.findIndex((s) => s.id === step);
}

export interface WorkspaceState {
  step: WorkspaceStep;
  project: CharacterReplaceProject;
  pricing: PricingState;
  photo: AssetSlot;
  video: AssetSlot;
  /** Part 6: the replacement audio picker. */
  audio: AssetSlot;
}

export const EMPTY_VOICE: VoiceSettings = {
  mode: "original",
  source: null,
  audio: null,
  trimAudioToFit: false,
  text: "",
  languageCode: null,
  voiceId: null,
  voiceConsent: false,
};

export const EMPTY_PROJECT: CharacterReplaceProject = {
  mode: "full_character",
  character: null,
  references: [],
  video: null,
  settings: { quality: "720p", trim: null },
  voice: EMPTY_VOICE,
  lipSync: { tier: null },
  consent: false,
};

export const INITIAL_STATE: WorkspaceState = {
  step: "photo",
  project: EMPTY_PROJECT,
  pricing: { status: "idle" },
  photo: { status: "empty" },
  video: { status: "empty" },
  audio: { status: "empty" },
};

export type WorkspaceAction =
  | { type: "go"; step: WorkspaceStep }
  /** Part 6: switch the replacement. `defaultQuality` is the mode's tier the settings step opens on. */
  | { type: "mode"; mode: ReplacementMode; defaultQuality: CharacterReplaceAnyQuality | null; maxReferences: number }
  | { type: "photo/validating" }
  | { type: "photo/ready"; asset: CharacterAsset }
  | { type: "photo/invalid"; code: string }
  | { type: "photo/error"; code: string }
  | { type: "photo/clear" }
  /** Part 6: an extra identity photo (Skin + Face). Refused past the mode's maximum. */
  | { type: "reference/add"; asset: CharacterAsset; max: number }
  | { type: "reference/remove"; index: number }
  | { type: "video/validating" }
  | { type: "video/ready"; video: SourceVideo; maxDurationMs: number }
  | { type: "video/invalid"; code: string }
  | { type: "video/error"; code: string }
  | { type: "video/clear" }
  | { type: "quality"; quality: CharacterReplaceAnyQuality }
  | { type: "trim"; start: number; end: number }
  | { type: "trim/clear" }
  | {
      type: "voice/mode";
      mode: "original" | "new_voice";
      defaults: { languageCode: string | null; voiceId: string | null; tier: "standard" | "studio" | null; source?: CharacterReplaceVoiceSource };
    }
  /** Part 6: upload your own audio, or generate from text. */
  | { type: "voice/source"; source: CharacterReplaceVoiceSource }
  | { type: "audio/validating" }
  | { type: "audio/ready"; asset: AudioAsset }
  | { type: "audio/invalid"; code: string }
  | { type: "audio/error"; code: string }
  | { type: "audio/clear" }
  | { type: "voice/text"; text: string }
  | { type: "voice/trimToFit"; value: boolean }
  | { type: "voice/consent"; value: boolean }
  | { type: "voice/language"; code: string }
  | { type: "voice/voice"; id: string }
  | { type: "lipsync/tier"; tier: "standard" | "studio" }
  /** Part 6: lip sync is a toggle — off keeps the new voice as a plain audio swap. */
  | { type: "lipsync/clear" }
  | { type: "consent"; value: boolean }
  | { type: "pricing"; pricing: PricingState }
  | { type: "reset" }
  /** Part 7 §15–§16: a fresh draft that keeps the character photo (and the mode) still in the browser's hand. */
  | { type: "reset/keep-photo" };

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "go":
      return canEnterStep(state.project, action.step) ? { ...state, step: action.step } : state;

    /* ── the mode (Part 6) ──────────────────────────────────────────────── */
    case "mode": {
      if (action.mode === state.project.mode) return state;
      // The files stay; the tier becomes the new mode's default; extra references beyond the new maximum go.
      const references = state.project.references.slice(0, Math.max(0, action.maxReferences - 1));
      return {
        ...state,
        pricing: markStale(state.pricing),
        project: {
          ...state.project,
          mode: action.mode,
          references,
          settings: { ...state.project.settings, quality: action.defaultQuality ?? state.project.settings.quality },
        },
      };
    }

    /* ── the photo slot ─────────────────────────────────────────────────── */
    case "photo/validating":
      // A pick replaces whatever was there: the project's asset is cleared
      // NOW, so a slow decode can never show the old photo as "ready".
      return { ...state, photo: { status: "validating" }, project: { ...state.project, character: null } };
    case "photo/ready":
      return { ...state, photo: { status: "ready" }, project: { ...state.project, character: action.asset } };
    case "photo/invalid":
      return { ...state, photo: { status: "invalid", code: action.code }, project: { ...state.project, character: null } };
    case "photo/error":
      return { ...state, photo: { status: "error", code: action.code }, project: { ...state.project, character: null } };
    case "photo/clear":
      return { ...state, photo: { status: "empty" }, project: { ...state.project, character: null } };

    /* ── extra references (Skin + Face) ─────────────────────────────────── */
    case "reference/add": {
      if (state.project.references.length >= Math.max(0, action.max - 1)) return state;
      return { ...state, project: { ...state.project, references: [...state.project.references, action.asset] } };
    }
    case "reference/remove":
      return { ...state, project: { ...state.project, references: state.project.references.filter((_, i) => i !== action.index) } };

    /* ── the video slot ─────────────────────────────────────────────────── */
    case "video/validating":
      // Same rule, and the trim goes with the old video: a kept range is a
      // fact about ONE file's timeline and means nothing on the next.
      return {
        ...state,
        video: { status: "validating" },
        pricing: { status: "idle" },
        project: { ...state.project, video: null, settings: { ...state.project.settings, trim: null } },
      };
    case "video/ready": {
      /*
        A video longer than the tool allows is not refused — it is accepted
        with the kept range pre-trimmed to the ceiling, so the member sees
        their video, sees the limit, and chooses which part to keep. The
        "continue" gate holds until the kept range fits.
      */
      const duration = action.video.metadata.durationMs;
      const trim =
        duration !== null && duration > action.maxDurationMs ? { start: 0, end: action.maxDurationMs / 1000 } : null;
      return {
        ...state,
        video: { status: "ready" },
        pricing: markStale(state.pricing),
        project: { ...state.project, video: action.video, settings: { ...state.project.settings, trim } },
      };
    }
    case "video/invalid":
      return {
        ...state,
        video: { status: "invalid", code: action.code },
        pricing: { status: "idle" },
        project: { ...state.project, video: null, settings: { ...state.project.settings, trim: null } },
      };
    case "video/error":
      return {
        ...state,
        video: { status: "error", code: action.code },
        pricing: { status: "idle" },
        project: { ...state.project, video: null, settings: { ...state.project.settings, trim: null } },
      };
    case "video/clear":
      return {
        ...state,
        video: { status: "empty" },
        pricing: { status: "idle" },
        project: { ...state.project, video: null, settings: { ...state.project.settings, trim: null } },
      };

    /* ── settings ───────────────────────────────────────────────────────── */
    case "quality":
      return { ...state, pricing: markStale(state.pricing), project: { ...state.project, settings: { ...state.project.settings, quality: action.quality } } };
    case "trim": {
      const durationMs = state.project.video?.metadata.durationMs ?? null;
      const duration = durationMs === null ? null : durationMs / 1000;
      const start = Math.max(0, Math.min(action.start, action.end));
      const end = duration === null ? Math.max(action.end, start) : Math.min(duration, Math.max(action.end, start));
      // Keeping the whole video is "no trim", not a trim of everything.
      const whole = start === 0 && duration !== null && end >= duration;
      return {
        ...state,
        pricing: markStale(state.pricing),
        project: { ...state.project, settings: { ...state.project.settings, trim: whole ? null : { start, end } } },
      };
    }
    case "trim/clear":
      return { ...state, pricing: markStale(state.pricing), project: { ...state.project, settings: { ...state.project.settings, trim: null } } };

    /* ── voice (Part 6) ─────────────────────────────────────────────────── */
    case "voice/mode": {
      if (action.mode === "original") {
        // Back to the original audio: the voice, its audio file and the tier all go.
        return {
          ...state,
          audio: { status: "empty" },
          pricing: markStale(state.pricing),
          project: { ...state.project, voice: EMPTY_VOICE, lipSync: { tier: null } },
        };
      }
      return {
        ...state,
        pricing: markStale(state.pricing),
        project: {
          ...state.project,
          voice: {
            ...EMPTY_VOICE,
            mode: "new_voice",
            source: action.defaults.source ?? "tts",
            languageCode: action.defaults.languageCode,
            voiceId: action.defaults.voiceId,
          },
          lipSync: { tier: action.defaults.tier },
        },
      };
    }
    case "voice/source": {
      if (state.project.voice.mode !== "new_voice" || state.project.voice.source === action.source) return state;
      // The other source's material is kept (a member may flip back), but the slot reflects the audio only when it is the source.
      return { ...state, pricing: markStale(state.pricing), project: { ...state.project, voice: { ...state.project.voice, source: action.source } } };
    }
    case "audio/validating":
      return { ...state, audio: { status: "validating" }, project: { ...state.project, voice: { ...state.project.voice, audio: null } } };
    case "audio/ready":
      return { ...state, audio: { status: "ready" }, pricing: markStale(state.pricing), project: { ...state.project, voice: { ...state.project.voice, audio: action.asset, trimAudioToFit: false } } };
    case "audio/invalid":
      return { ...state, audio: { status: "invalid", code: action.code }, project: { ...state.project, voice: { ...state.project.voice, audio: null } } };
    case "audio/error":
      return { ...state, audio: { status: "error", code: action.code }, project: { ...state.project, voice: { ...state.project.voice, audio: null } } };
    case "audio/clear":
      return { ...state, audio: { status: "empty" }, project: { ...state.project, voice: { ...state.project.voice, audio: null, trimAudioToFit: false } } };
    case "voice/text": {
      const text = action.text.slice(0, 10_000);
      // The price depends on the dialogue's LENGTH (per-character), so a change of length is a change of price.
      const lengthChanged = Array.from(text.trim()).length !== Array.from(state.project.voice.text.trim()).length;
      return { ...state, pricing: lengthChanged ? markStale(state.pricing) : state.pricing, project: { ...state.project, voice: { ...state.project.voice, text } } };
    }
    case "voice/trimToFit":
      return { ...state, project: { ...state.project, voice: { ...state.project.voice, trimAudioToFit: action.value } } };
    case "voice/consent":
      return { ...state, project: { ...state.project, voice: { ...state.project.voice, voiceConsent: action.value } } };
    case "voice/language":
      return { ...state, project: { ...state.project, voice: { ...state.project.voice, languageCode: action.code } } };
    case "voice/voice":
      return { ...state, project: { ...state.project, voice: { ...state.project.voice, voiceId: action.id } } };
    case "lipsync/tier":
      return { ...state, pricing: markStale(state.pricing), project: { ...state.project, lipSync: { tier: action.tier } } };
    case "lipsync/clear":
      return state.project.lipSync.tier === null ? state : { ...state, pricing: markStale(state.pricing), project: { ...state.project, lipSync: { tier: null } } };

    case "consent":
      return { ...state, project: { ...state.project, consent: action.value } };
    case "pricing":
      return { ...state, pricing: action.pricing };
    case "reset":
      return INITIAL_STATE;
    case "reset/keep-photo":
      return {
        ...INITIAL_STATE,
        step: state.project.character ? "video" : "photo",
        photo: state.project.character ? { status: "ready" } : { status: "empty" },
        project: { ...EMPTY_PROJECT, mode: state.project.mode, character: state.project.character },
      };
  }
}

/** A quote the inputs have moved away from is stale, not gone. */
function markStale(pricing: PricingState): PricingState {
  if (pricing.status === "quoted") return { status: "stale", snapshot: pricing.snapshot };
  return pricing;
}

/* ───────────────────────────── derived facts ─────────────────────────────── */

/** The source's length in seconds, from the integer milliseconds it is stored as. */
export function originalDurationSeconds(project: CharacterReplaceProject): number | null {
  const ms = project.video?.metadata.durationMs ?? null;
  return ms === null ? null : ms / 1000;
}

/** Seconds the job would process: the kept range, or the whole video. */
export function selectedDurationSeconds(project: CharacterReplaceProject): number | null {
  const range = selectedRangeMs(project);
  return range === null ? null : (range.endMs - range.startMs) / 1000;
}

/**
 * Seconds the member's trim has REMOVED — original minus kept. Zero with no
 * trim. The interface says "Trimmed by 4.0 sec" from it; what a further trim
 * would save in money is the pricing engine's sentence (§10), not this one's.
 */
export function trimmedSeconds(project: CharacterReplaceProject): number | null {
  const duration = originalDurationSeconds(project);
  const selected = selectedDurationSeconds(project);
  if (duration === null || selected === null) return null;
  return Math.max(0, duration - selected);
}

/**
 * Whether the kept range fits the tool — the readiness layer's answer for
 * the trim alone. Kept as a name because the settings step colours the
 * selected duration by it.
 */
export function videoFits(project: CharacterReplaceProject, config: CharacterReplacePublicConfig | null): boolean {
  const { issues } = inputReadiness(project, config);
  return !issues.some((i) => i === "trim-too-long" || i === "trim-too-short" || i === "trim-invalid" || i === "video-unmeasured");
}

/** Whether a step may be opened, given what has been provided so far. */
export function canEnterStep(project: CharacterReplaceProject, step: WorkspaceStep): boolean {
  switch (step) {
    case "photo":
      return true;
    case "video":
      return !!project.character;
    case "settings":
    case "voice":
    case "review":
      return !!project.character && !!project.video;
  }
}

/** The furthest step the member has earned. Drives which stepper items are live. */
export function furthestStep(project: CharacterReplaceProject): WorkspaceStep {
  if (!project.character) return "photo";
  if (!project.video) return "video";
  return "review";
}

/** The dialogue's length as the engine counts it — code points, trimmed. */
export function dialogueCharacters(text: string): number {
  return Array.from(text.trim()).length;
}

/**
 * Whether the voice section is complete (Part 6): nothing to say for the
 * original audio; an uploaded voice needs the file and the rights
 * confirmation; a generated voice needs a dialogue within the operator's
 * bounds, a language the provider speaks and a voice. Lip sync is optional
 * with either.
 */
export function voiceComplete(project: CharacterReplaceProject, config: CharacterReplacePublicConfig | null): boolean {
  const v = project.voice;
  if (v.mode !== "new_voice") return true;
  if (v.source === "upload") return !!v.audio && v.voiceConsent;
  if (v.source === "tts") {
    const chars = dialogueCharacters(v.text);
    const min = config?.tts.minimumCharacters ?? 1;
    const max = config?.tts.maximumCharacters ?? 10_000;
    if (chars < min || chars > max) return false;
    if (!v.languageCode || !v.voiceId) return false;
    if (config && !config.tts.languages.includes(v.languageCode)) return false;
    return true;
  }
  return false;
}

/**
 * Whether Start may be pressed. Every clause is a fact the interface can
 * verify locally; the SERVER re-verifies all of them and the balance at
 * /start. In Part 1 and Part 2 `pricing` is never `quoted`, so this is false
 * everywhere — deliberately, and the review step says why.
 */
export function canStart(input: {
  project: CharacterReplaceProject;
  pricing: PricingState;
  config: CharacterReplacePublicConfig | null;
  available: boolean;
  balanceCents: number | null;
}): boolean {
  const { project, pricing, config } = input;
  if (!config || !input.available) return false;
  if (!project.consent) return false;
  if (!inputReadiness(project, config).ready) return false;
  if (!voiceComplete(project, config)) return false;
  if (pricing.status !== "quoted") return false;
  if (input.balanceCents === null || input.balanceCents < pricing.snapshot.totalCents) return false;
  return true;
}

/* ───────────────────────────── the summary lines ─────────────────────────── */

/** "10.0 sec" — one decimal, always, so 10 and 10.04 read the same. */
export function formatSeconds(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  return `${(Math.round(seconds * 10) / 10).toFixed(1)} sec`;
}

/** "00:03.2" — minutes, seconds, tenths. The trim's own clock. */
export function formatClock(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "--:--.-";
  const tenths = Math.round(seconds * 10);
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  const t = tenths % 10;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${t}`;
}

/** The tier label for the current mode, from the public config. */
export function qualityLabelFor(project: CharacterReplaceProject, config: CharacterReplacePublicConfig | null): string {
  const mode = config?.modes.find((m) => m.id === project.mode);
  const tier = mode?.tiers.find((t) => t.id === project.settings.quality) ?? config?.qualities.find((q) => q.id === project.settings.quality);
  return tier?.label ?? project.settings.quality;
}

/**
 * The summary card's rows, from the draft alone. They carry NO amounts —
 * `amountCents` is null on every line until a server snapshot replaces them —
 * which is what keeps the browser from ever implying a price it did not get.
 */
export function summaryLines(project: CharacterReplaceProject, config: CharacterReplacePublicConfig | null): PricingLine[] {
  const language = config?.languages.find((l) => l.code === project.voice.languageCode);
  const voice = config?.voices.find((v) => v.id === project.voice.voiceId);
  const tier = config?.lipSync.find((l) => l.id === project.lipSync.tier);
  const newVoice = project.voice.mode === "new_voice";
  const voiceValue = !newVoice
    ? "Original audio"
    : project.voice.source === "upload"
      ? project.voice.audio
        ? "Your audio"
        : "Your audio · not chosen yet"
      : [language?.label, voice?.label].filter(Boolean).join(" · ") || "New voice";
  return [
    { key: "video", label: "Video", value: formatSeconds(selectedDurationSeconds(project)), amountCents: null },
    { key: "quality", label: "Quality", value: qualityLabelFor(project, config), amountCents: null },
    { key: "character", label: "Replacement", value: REPLACEMENT_MODE_COPY[project.mode].label, amountCents: null },
    { key: "voice", label: "Voice", value: voiceValue, amountCents: null },
    { key: "lipSync", label: "Lip sync", value: newVoice && tier ? tier.label : "Not selected", amountCents: null },
  ];
}
