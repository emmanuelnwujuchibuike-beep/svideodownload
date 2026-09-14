import "server-only";

import { AiJobError } from "@/lib/ai/errors";
import type { AiJobStatus } from "@/lib/ai/jobs";
import { createReplicatePrediction, toState } from "@/lib/ai/replicate/provider";
import { minimaxLanguageHint, ttsSupportedLanguagesFor } from "@/lib/ai/voice/tts-languages";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  TEXT-TO-SPEECH — the provider seam, and its first implementation
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, Part 6 §5: "Do NOT hard-code one TTS provider throughout the
 * application. Create TextToSpeechProvider and a provider implementation
 * such as ReplicateTextToSpeechProvider. The provider must be replaceable
 * later… The admin should eventually be able to change the active
 * provider/model without rewriting the Character Replace UI."
 *
 * The application layer (submit.ts's voice stage, the config route, the
 * verifier at /start) sees this interface: which languages it speaks, how
 * to ask for a voice, how to read a prediction back. The MiniMax adapter
 * below is the only file that knows `voice_id`, `language_boost` or that
 * the answer is a Replicate prediction. A second adapter — ElevenLabs on
 * Replicate, or a vendor of its own — implements the same interface and is
 * chosen by the model name the operator configured.
 *
 * ── 🔴 VOICE CLONING IS NOT OFFERED (§6) ────────────────────────────────────
 *
 * MiniMax accepts a `voice_id` returned by its voice-cloning model. This
 * adapter only ever sends a voice from the OPERATOR'S CATALOGUE (config.ts
 * `voices[].providerVoiceId`, one of the provider's system voices), never a
 * value a member typed. "Create videos using your own voice or voices you
 * have permission to use" is served by the upload path; a cloned voice is
 * not a workflow this product has, and there is no field through which a
 * clone id could arrive.
 */

export interface TextToSpeechRequest {
  jobId: string;
  text: string;
  /** BCP-47 primary subtag from the catalogue — already validated against `supportedLanguages()`. */
  languageCode: string;
  /** The provider's own voice id from the operator's catalogue, or null for the provider's default. */
  providerVoiceId: string | null;
  webhookUrl: string;
}

export interface TextToSpeechSubmission {
  reference: string;
  status: AiJobStatus;
  model: string;
  modelVersion: string | null;
  /** What was sent, minus the text — for the operator's record. */
  settings: Record<string, unknown>;
}

export interface TextToSpeechProvider {
  readonly id: "replicate";
  readonly model: string;
  readonly version: string;
  isConfigured(): boolean;
  /** Language codes this provider (this model) speaks. The public config intersects the catalogue with it. */
  supportedLanguages(): readonly string[];
  /** Build the payload from validated values; exposed for tests. */
  buildInput(req: Omit<TextToSpeechRequest, "jobId" | "webhookUrl">): Record<string, unknown>;
  createPrediction(req: TextToSpeechRequest): Promise<TextToSpeechSubmission>;
}

/* ───────────────────────────── MiniMax Speech-02 on Replicate ─────────────── */

/**
 * Read from the live schemas on 2026-09-14:
 *
 *   minimax/speech-02-hd     version b2c687e5…  (2026-04-21) — "high-fidelity… voiceovers"
 *   minimax/speech-02-turbo  version f3964938…  (2026-04-20) — "real-time… low latency"
 *
 *   text             string     required, max 10,000 characters
 *   voice_id         string     default "English_Wiselady" — a system voice
 *   speed            0.5–2      default 1
 *   volume           0–10       default 1
 *   pitch            -12..12    default 0
 *   emotion          enum       default "auto"
 *   english_normalization  bool default false
 *   sample_rate      enum       default 32000
 *   bitrate          enum       default 128000 (mp3 only)
 *   audio_format     "mp3" | "wav" | "flac" | "pcm"   default "mp3"
 *   channel          "mono" | "stereo"   default "mono"
 *   subtitle_enable  bool
 *   language_boost   enum (39 locales)   default "None"
 *   output           string (uri)
 *
 * `buildInput` asks for WAV at 32 kHz mono — what the lip-sync provider
 * takes ("Input audio file (.wav)") without a second encode — and the
 * language hint from the catalogue. Nothing else is sent: speed, pitch and
 * emotion are the model's defaults until a member-facing control exists.
 */
const MINIMAX_VERSIONS: Record<string, string> = {
  "minimax/speech-02-hd": "b2c687e53557eee08b35b59620f88750671e97b9a91f351ea6797ac838a0773d",
  "minimax/speech-02-turbo": "f39649380c14fcc2263e2cc4f27d112629b72e95d7c5a8e5eb23bd90444fd34c",
};

export interface MiniMaxInput {
  text: string;
  voice_id?: string;
  language_boost: string;
  audio_format: "wav";
  sample_rate: 32000;
  channel: "mono";
}

export const MINIMAX_INPUT_FIELDS = ["text", "voice_id", "language_boost", "audio_format", "sample_rate", "channel"] as const;

export function buildMiniMaxInput(req: { text: string; languageCode: string; providerVoiceId: string | null }): MiniMaxInput {
  const hint = minimaxLanguageHint(req.languageCode);
  if (!hint) throw new AiJobError("INVALID_INPUT", `MiniMax does not speak ${req.languageCode}`);
  const input: MiniMaxInput = {
    text: req.text,
    language_boost: hint,
    audio_format: "wav",
    sample_rate: 32000,
    channel: "mono",
  };
  if (req.providerVoiceId) input.voice_id = req.providerVoiceId;
  return input;
}

export function replicateMiniMaxProvider(model: string): TextToSpeechProvider {
  const version = process.env.REPLICATE_TTS_VERSION?.trim() || MINIMAX_VERSIONS[model] || "";
  return {
    id: "replicate",
    model,
    version,
    isConfigured() {
      return !!process.env.REPLICATE_API_TOKEN?.trim() && !!version;
    },
    supportedLanguages() {
      return ttsSupportedLanguagesFor(model);
    },
    buildInput(req) {
      return buildMiniMaxInput(req) as unknown as Record<string, unknown>;
    },
    async createPrediction(req) {
      if (!this.isConfigured()) throw new AiJobError("FEATURE_UNAVAILABLE", `text-to-speech model ${model} is not configured`);
      const input = this.buildInput(req);
      const body = await createReplicatePrediction({ jobId: req.jobId, version, input, webhookUrl: req.webhookUrl, label: "tts" });
      const state = toState(body, body.id);
      const { text: _text, ...settings } = input;
      return { reference: state.reference, status: state.status, model, modelVersion: state.modelVersion ?? version, settings };
    },
  };
}

/**
 * The provider for the model the operator configured. A model this build
 * has no adapter for answers an adapter that reports itself unconfigured
 * and speaks no language — the safe failure: TTS is simply not offered
 * until an adapter exists (§5: "the provider must be replaceable later").
 */
export function textToSpeechProviderFor(model: string): TextToSpeechProvider {
  if (/^minimax\/speech-02-(hd|turbo)$/.test(model)) return replicateMiniMaxProvider(model);
  return {
    id: "replicate",
    model,
    version: "",
    isConfigured: () => false,
    supportedLanguages: () => [],
    buildInput: () => {
      throw new AiJobError("FEATURE_UNAVAILABLE", `no text-to-speech adapter for ${model}`);
    },
    createPrediction: async () => {
      throw new AiJobError("FEATURE_UNAVAILABLE", `no text-to-speech adapter for ${model}`);
    },
  };
}
