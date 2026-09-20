import "server-only";

import { AiJobError } from "@/lib/ai/errors";
import { elevenLabsConfigured, elevenLabsSpeechToSpeech } from "@/lib/ai/voice/elevenlabs";
import { elevenLabsStsModel } from "@/lib/ai/voice/elevenlabs-models";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  VOICE CHANGE — a recording, re-voiced in a catalogue voice
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-20: "when converting a video to audio a gender and voice
 * set-up should be available in the run steps." A member who brings their
 * own recording (an audio file, or a gallery video's sound) can have it
 * spoken by a catalogue voice of the gender and age they choose. The words,
 * the timing and the emotion are the recording's; the voice is the
 * catalogue's.
 *
 * The same seam shape as text-to-speech: an interface, one implementation,
 * chosen by the model name the operator configured. Always a catalogue
 * voice's provider id — never a value a member typed, never a clone.
 *
 * Runs in the WORKER, after the upload has been fitted to the video: the
 * fitted WAV goes to the provider, the MP3 that comes back is fitted again
 * (the provider keeps the timing, so this is a formality that also
 * re-measures it) and becomes `audio.prepared`.
 */
export interface VoiceChangeRequest {
  jobId: string;
  /** The fitted recording. */
  audio: Buffer;
  audioMime: string;
  /** The catalogue voice's provider id. */
  providerVoiceId: string;
}

export interface VoiceChangeProvider {
  readonly id: "elevenlabs";
  readonly model: string;
  isConfigured(): boolean;
  /** Language codes the changer handles well; the catalogue's language is checked against it at /start. */
  supportedLanguages(): readonly string[];
  convert(req: VoiceChangeRequest): Promise<{ bytes: Buffer; mime: string }>;
}

export function elevenLabsVoiceChangeProvider(model: string): VoiceChangeProvider {
  const spec = elevenLabsStsModel(model);
  return {
    id: "elevenlabs",
    model,
    isConfigured() {
      return !!spec && elevenLabsConfigured();
    },
    supportedLanguages() {
      return spec ? spec.languages : [];
    },
    async convert(req) {
      if (!spec || !elevenLabsConfigured()) throw new AiJobError("FEATURE_UNAVAILABLE", `voice-change model ${model} is not configured`);
      if (!req.providerVoiceId) throw new AiJobError("INVALID_INPUT", "a voice change needs the catalogue's provider voice id");
      return elevenLabsSpeechToSpeech({ audio: req.audio, audioMime: req.audioMime, filename: "voice.wav", modelId: spec.modelId, providerVoiceId: req.providerVoiceId });
    },
  };
}

/** The provider for the configured model; an unknown model reports itself unconfigured (the feature is simply not offered). */
export function voiceChangeProviderFor(model: string): VoiceChangeProvider {
  if (elevenLabsStsModel(model)) return elevenLabsVoiceChangeProvider(model);
  return {
    id: "elevenlabs",
    model,
    isConfigured: () => false,
    supportedLanguages: () => [],
    convert: async () => {
      throw new AiJobError("FEATURE_UNAVAILABLE", `no voice-change adapter for ${model}`);
    },
  };
}
