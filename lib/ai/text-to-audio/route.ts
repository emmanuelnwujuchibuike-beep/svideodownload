import "server-only";

import type { CharacterReplaceConfig, CharacterReplaceVoice } from "@/lib/ai/character-replace/config";
import type { TextToAudioConfig, TextToAudioRoute } from "@/lib/ai/text-to-audio/config";
import { textToSpeechProviderFor, type TextToSpeechProvider } from "@/lib/ai/voice/tts-provider";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  TEXT TO AUDIO — the route the switch chose, and the voices it can speak
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner: "the text to speech should also switch to the Replicate ElevenLabs
 * v3 or the direct ElevenLabs API in the admin dashboard." The switch is
 * `config.route`; each route has its own model (config.models[route]) and
 * its own adapter (lib/ai/voice/tts-provider.ts):
 *
 *   replicate   `elevenlabs/v3` … — `runsIn: "replicate"`: a prediction, the
 *               webhook, the finalizer brings the MP3 home
 *   elevenlabs  `elevenlabs/eleven_v3` … — `runsIn: "worker"`: a synchronous
 *               call answering with the audio; Text to Audio makes it right
 *               after the response (`after()`), no worker involved
 *
 * ElevenLabs is the only vendor either way (the fal.ai brief §17 locked it).
 * A route whose adapter is not configured on this deployment (no
 * REPLICATE_API_TOKEN / no ELEVENLABS_API_KEY) reports so and nothing is
 * offered — never a silent fall-through to the other route: the operator
 * chose, and a charge under a route they did not choose is a surprise bill.
 */
export interface TextToAudioResolvedRoute {
  route: TextToAudioRoute;
  model: string;
  provider: TextToSpeechProvider;
  enabled: boolean;
  configured: boolean;
  diagnostic: string | null;
}

export function resolveTextToAudioRoute(config: TextToAudioConfig): TextToAudioResolvedRoute {
  const route = config.route;
  const choice = config.models[route];
  const provider = textToSpeechProviderFor(choice.model);
  const configured = provider.isConfigured();
  const enabled = config.enabled && choice.enabled;
  const diagnostic = !config.enabled ? "Text to Audio is switched off" : !choice.enabled ? `the ${route} model is switched off` : !configured ? (route === "replicate" ? "REPLICATE_API_TOKEN is not set on this deployment" : "ELEVENLABS_API_KEY is not set on this deployment") : null;
  return { route, model: choice.model, provider, enabled, configured, diagnostic };
}

/** The catalogue provider whose rows the route can use: Replicate's model takes voice NAMES; the direct API takes the account's voice IDS. */
export function catalogueProviderForRoute(route: TextToAudioRoute): CharacterReplaceVoice["provider"] {
  return route === "replicate" ? "elevenlabs" : "elevenlabs_api";
}

export interface TextToAudioPublicVoice {
  id: string;
  label: string;
  blurb: string;
  languages: readonly string[];
  gender: string;
  age?: string;
  /** 2026-09-27: one of the member's own cloned voices (lib/ai/voice-clone/usable.ts), not a catalogue row. */
  own?: boolean;
}

/**
 * Whether this route can speak a member's CLONED voice. Only the direct API
 * can: the Replicate wrapper takes one of 26 fixed voice NAMES, and a clone
 * has none of them. Pure, and the one answer both the offer and the check read.
 */
export function routeAllowsClones(route: TextToAudioRoute): boolean {
  return route === "elevenlabs";
}

/** The voices and languages the active route can honour, filtered by the operator's allow-lists. Never a provider id. */
export function textToAudioVoices(config: TextToAudioConfig, cr: CharacterReplaceConfig, resolved: TextToAudioResolvedRoute): { voices: TextToAudioPublicVoice[]; languages: { code: string; label: string; native: string }[] } {
  const provider = catalogueProviderForRoute(resolved.route);
  const spoken = new Set(resolved.provider.supportedLanguages());
  const voices = cr.voices.filter((v) => v.provider === provider && (!config.voiceIds.length || config.voiceIds.includes(v.id))).map((v) => ({ id: v.id, label: v.label, blurb: v.blurb, languages: v.languages, gender: v.gender, age: v.age }));
  const languages = cr.languages.filter((l) => spoken.has(l.code) && (!config.languageCodes.length || config.languageCodes.includes(l.code)));
  return { voices, languages };
}
