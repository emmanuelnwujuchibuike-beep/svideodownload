/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  TEXT-TO-SPEECH — which languages the configured provider can actually speak
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, Part 6 §7: "Do NOT hard-code a fake list. The actual selectable
 * languages must come from provider/configuration capabilities… The backend
 * must validate the selected language against the configured provider."
 *
 * Pure, and read by BOTH sides: the server's TTS adapter builds its
 * `language_boost` hint from it, and `publicCharacterReplaceConfig`
 * intersects the operator's language catalogue with it so the interface never
 * offers a language the provider would silently render in the wrong accent.
 *
 * ── MiniMax Speech-02 (the initial provider) ────────────────────────────────
 *
 * Read from the live Replicate schema of minimax/speech-02-hd on 2026-09-14:
 * the `language_boost` enum names 39 locales. Each row maps a BCP-47 primary
 * subtag (the code the operator's catalogue uses) to the hint value the
 * provider takes. A code with no row is NOT supported by this provider —
 * Yoruba, Igbo and Hausa in the default catalogue are exactly that today,
 * and stay in the catalogue for a provider that speaks them.
 */

import { elevenLabsTtsModel } from "@/lib/ai/voice/elevenlabs-models";

export interface TtsLanguageCapability {
  /** BCP-47 primary subtag, lower-case — the catalogue's key. */
  code: string;
  /** The provider's own name for the language hint. */
  providerHint: string;
}

export const MINIMAX_LANGUAGE_HINTS: readonly TtsLanguageCapability[] = [
  { code: "en", providerHint: "English" },
  { code: "zh", providerHint: "Chinese" },
  { code: "yue", providerHint: "Cantonese" },
  { code: "ar", providerHint: "Arabic" },
  { code: "ru", providerHint: "Russian" },
  { code: "es", providerHint: "Spanish" },
  { code: "fr", providerHint: "French" },
  { code: "pt", providerHint: "Portuguese" },
  { code: "de", providerHint: "German" },
  { code: "tr", providerHint: "Turkish" },
  { code: "nl", providerHint: "Dutch" },
  { code: "uk", providerHint: "Ukrainian" },
  { code: "vi", providerHint: "Vietnamese" },
  { code: "id", providerHint: "Indonesian" },
  { code: "ja", providerHint: "Japanese" },
  { code: "it", providerHint: "Italian" },
  { code: "ko", providerHint: "Korean" },
  { code: "th", providerHint: "Thai" },
  { code: "pl", providerHint: "Polish" },
  { code: "ro", providerHint: "Romanian" },
  { code: "el", providerHint: "Greek" },
  { code: "cs", providerHint: "Czech" },
  { code: "fi", providerHint: "Finnish" },
  { code: "hi", providerHint: "Hindi" },
  { code: "bg", providerHint: "Bulgarian" },
  { code: "da", providerHint: "Danish" },
  { code: "he", providerHint: "Hebrew" },
  { code: "ms", providerHint: "Malay" },
  { code: "fa", providerHint: "Persian" },
  { code: "sk", providerHint: "Slovak" },
  { code: "sv", providerHint: "Swedish" },
  { code: "hr", providerHint: "Croatian" },
  { code: "tl", providerHint: "Filipino" },
  { code: "hu", providerHint: "Hungarian" },
  { code: "no", providerHint: "Norwegian" },
  { code: "sl", providerHint: "Slovenian" },
  { code: "ca", providerHint: "Catalan" },
  { code: "ta", providerHint: "Tamil" },
  { code: "af", providerHint: "Afrikaans" },
] as const;

const MINIMAX_BY_CODE = new Map(MINIMAX_LANGUAGE_HINTS.map((l) => [l.code, l.providerHint]));

/** The provider's hint for a language, or null when this provider does not speak it. */
export function minimaxLanguageHint(code: string): string | null {
  return MINIMAX_BY_CODE.get(code.toLowerCase()) ?? null;
}

/** Every language code the MiniMax adapter accepts. */
export function minimaxSupportedLanguages(): readonly string[] {
  return MINIMAX_LANGUAGE_HINTS.map((l) => l.code);
}

/**
 * The capability table keyed by the TTS model an operator has configured.
 * A model this build does not know answers an EMPTY list, which the public
 * config turns into "no languages offered" — the safe failure (§7): an
 * unknown model cannot be assumed to speak anything.
 */
export function ttsSupportedLanguagesFor(model: string): readonly string[] {
  if (/^minimax\/speech-02/.test(model)) return minimaxSupportedLanguages();
  // 2026-09-20: the ElevenLabs models, each with the list its documentation gives (elevenlabs-models.ts).
  const eleven = elevenLabsTtsModel(model);
  if (eleven) return eleven.languages;
  return [];
}
