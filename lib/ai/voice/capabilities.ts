import "server-only";

import type { CharacterReplaceConfig, VoiceCapabilities } from "@/lib/ai/character-replace/config";
import { textToSpeechProviderFor } from "@/lib/ai/voice/tts-provider";
import { voiceChangeProviderFor } from "@/lib/ai/voice/voice-change-provider";

/**
 * Whether the voice providers the operator configured are actually usable
 * on THIS deployment — the keys are present (2026-09-20: the owner switched
 * "Change the voice" on and pressed Create before ELEVENLABS_API_KEY existed
 * anywhere; Start answered "this tool isn't available yet" for a feature the
 * interface had just offered). The public config reads this so the offer and
 * the refusal can never disagree.
 */
export function voiceCapabilities(config: CharacterReplaceConfig): VoiceCapabilities {
  return {
    ttsConfigured: textToSpeechProviderFor(config.tts.model).isConfigured(),
    voiceChangeConfigured: voiceChangeProviderFor(config.tts.voiceChange.model).isConfigured(),
  };
}
