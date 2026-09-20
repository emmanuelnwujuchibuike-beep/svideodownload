/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ELEVENLABS — the models, the languages each speaks, the voice vocabulary
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-20: "the text to speech is very very poor, I thought we are
 * using eleven lab v3; if we are not, let's use eleven lab v3, and let users
 * set gender type in text to speech, and when converting a video to audio a
 * gender and voice set-up should be available in the run steps, and the
 * gender should include gender and age types … text to audio with eleven
 * lab v3 should be very clean and realistic."
 *
 * PURE — read by the server adapters (lib/ai/voice/tts-provider.ts,
 * voice-change-provider.ts), by the config normaliser and by the admin form.
 * Nothing here knows a key, a URL or a job.
 *
 * ── Model ids ───────────────────────────────────────────────────────────────
 * The operator configures a model as `elevenlabs/<model_id>`, the same shape
 * the MiniMax rows use (`minimax/speech-02-hd`), so one text field on the
 * admin form names any provider's model. `modelId` is what the ElevenLabs
 * API is sent.
 *
 * ── Languages ───────────────────────────────────────────────────────────────
 * Read from ElevenLabs' model documentation on 2026-09-20. v3 and
 * Multilingual v2 detect the language from the text (the API refuses a
 * `language_code` for them); Turbo/Flash v2.5 accept one and are sent it.
 * A catalogue language with no row here is NOT offered for that model —
 * the public config intersects the two, exactly as it does for MiniMax.
 *
 * ── The voice vocabulary ────────────────────────────────────────────────────
 * ElevenLabs labels every voice with a gender and an age from a small fixed
 * set; the catalogue carries the same two words so a member can filter by
 * them (owner: "gender and age types so users can get an accurate result").
 */

export type VoiceGender = "female" | "male" | "neutral";
export type VoiceAge = "young" | "middle_aged" | "old";

export const VOICE_GENDERS: readonly VoiceGender[] = ["female", "male", "neutral"] as const;
export const VOICE_AGES: readonly VoiceAge[] = ["young", "middle_aged", "old"] as const;

export function isVoiceGender(v: unknown): v is VoiceGender {
  return typeof v === "string" && (VOICE_GENDERS as readonly string[]).includes(v);
}
export function isVoiceAge(v: unknown): v is VoiceAge {
  return typeof v === "string" && (VOICE_AGES as readonly string[]).includes(v);
}

/** Member-facing words. Never a provider term. */
export const VOICE_GENDER_LABEL: Record<VoiceGender, string> = { female: "Female", male: "Male", neutral: "Neutral" };
export const VOICE_AGE_LABEL: Record<VoiceAge, string> = { young: "Young", middle_aged: "Middle-aged", old: "Older" };

export interface ElevenLabsTtsModel {
  /** The API's model_id. */
  modelId: string;
  /** Admin-facing name. */
  label: string;
  /** Whether the API accepts `language_code` for this model (only Turbo/Flash v2.5 do). */
  languageCodeParam: boolean;
  /** The provider's per-request character ceiling. */
  maxCharacters: number;
  /** BCP-47 primary subtags this model speaks. */
  languages: readonly string[];
}

/** The 29 languages of Multilingual v2 (and of the multilingual voice-changer). */
const MULTILINGUAL_V2: readonly string[] = ["en", "ja", "zh", "de", "hi", "fr", "ko", "pt", "it", "es", "id", "nl", "tr", "tl", "pl", "sv", "bg", "ro", "ar", "cs", "el", "fi", "hr", "ms", "sk", "da", "ta", "uk", "ru"];
/** Turbo/Flash v2.5 add Hungarian, Norwegian and Vietnamese. */
const V2_5: readonly string[] = [...MULTILINGUAL_V2, "hu", "no", "vi"];
/** v3: 70+ languages. */
const V3: readonly string[] = [
  ...V2_5,
  "af", "hy", "as", "az", "be", "bn", "bs", "ca", "ceb", "ny", "et", "gl", "ka", "gu", "ha", "he", "is", "ga", "jv", "kn", "kk", "ky", "lv", "ln", "lt", "lb", "mk", "ml", "mr", "ne", "ps", "fa", "pa", "sr", "sd", "sl", "so", "sw", "te", "ur", "cy",
];

export const ELEVENLABS_TTS_MODELS: Readonly<Record<string, ElevenLabsTtsModel>> = {
  "elevenlabs/eleven_v3": { modelId: "eleven_v3", label: "ElevenLabs v3 — the most expressive, 70+ languages", languageCodeParam: false, maxCharacters: 5_000, languages: V3 },
  "elevenlabs/eleven_multilingual_v2": { modelId: "eleven_multilingual_v2", label: "ElevenLabs Multilingual v2 — stable, 29 languages", languageCodeParam: false, maxCharacters: 10_000, languages: MULTILINGUAL_V2 },
  "elevenlabs/eleven_turbo_v2_5": { modelId: "eleven_turbo_v2_5", label: "ElevenLabs Turbo v2.5 — fast, 32 languages", languageCodeParam: true, maxCharacters: 40_000, languages: V2_5 },
  "elevenlabs/eleven_flash_v2_5": { modelId: "eleven_flash_v2_5", label: "ElevenLabs Flash v2.5 — fastest, 32 languages", languageCodeParam: true, maxCharacters: 40_000, languages: V2_5 },
};

export const ELEVENLABS_DEFAULT_TTS_MODEL = "elevenlabs/eleven_v3";

export function isElevenLabsTtsModel(model: string): boolean {
  return Object.prototype.hasOwnProperty.call(ELEVENLABS_TTS_MODELS, model);
}

export function elevenLabsTtsModel(model: string): ElevenLabsTtsModel | null {
  return ELEVENLABS_TTS_MODELS[model] ?? null;
}

/* ───────────────────────────── voice changer (speech → speech) ───────────── */

export interface ElevenLabsStsModel {
  modelId: string;
  label: string;
  languages: readonly string[];
}

/**
 * The voice changer takes a recording and re-voices it in a catalogue voice —
 * what "converting a video to audio [with] a gender and voice set-up" is.
 * There is no v3 voice changer; Multilingual STS v2 is the current one.
 */
export const ELEVENLABS_STS_MODELS: Readonly<Record<string, ElevenLabsStsModel>> = {
  "elevenlabs/eleven_multilingual_sts_v2": { modelId: "eleven_multilingual_sts_v2", label: "ElevenLabs Multilingual voice changer v2", languages: MULTILINGUAL_V2 },
  "elevenlabs/eleven_english_sts_v2": { modelId: "eleven_english_sts_v2", label: "ElevenLabs English voice changer v2", languages: ["en"] },
};

export const ELEVENLABS_DEFAULT_STS_MODEL = "elevenlabs/eleven_multilingual_sts_v2";

export function elevenLabsStsModel(model: string): ElevenLabsStsModel | null {
  return ELEVENLABS_STS_MODELS[model] ?? null;
}

/* ───────────────────────────── the default catalogue ─────────────────────── */

export interface ElevenLabsCatalogueVoice {
  id: string;
  label: string;
  blurb: string;
  gender: VoiceGender;
  age: VoiceAge;
  providerVoiceId: string;
}

/**
 * ElevenLabs' own default voice library, as documented on 2026-09-20 —
 * every account can use these without adding them. The ids are the
 * provider's; the words are ours. 🔴 The admin's "Import voices" action
 * (app/api/admin/ai/character-replace/voices/import) reads the ACCOUNT's
 * list from the API and is the authority: run it once the key is set, and
 * anything here that the account cannot see is replaced by what it can.
 */
export const ELEVENLABS_DEFAULT_VOICES: readonly ElevenLabsCatalogueVoice[] = [
  { id: "aria", label: "Aria", blurb: "Expressive, with a husky edge.", gender: "female", age: "middle_aged", providerVoiceId: "9BWtsMINqrJLrRacOk9x" },
  { id: "sarah", label: "Sarah", blurb: "Soft, warm and confident.", gender: "female", age: "young", providerVoiceId: "EXAVITQu4vr4xnSDxMaL" },
  { id: "laura", label: "Laura", blurb: "Upbeat and bright.", gender: "female", age: "young", providerVoiceId: "FGY2WhTYpPnrIDTdsKH5" },
  { id: "charlotte", label: "Charlotte", blurb: "Seductive, with a light accent.", gender: "female", age: "young", providerVoiceId: "XB0fDUnXU5powFXDhCwa" },
  { id: "alice", label: "Alice", blurb: "Clear and confident, British.", gender: "female", age: "middle_aged", providerVoiceId: "Xb7hH8MSUJpSbSDYk0k2" },
  { id: "matilda", label: "Matilda", blurb: "Friendly and steady.", gender: "female", age: "middle_aged", providerVoiceId: "XrExE9yKIg1WjnnlVkGX" },
  { id: "jessica", label: "Jessica", blurb: "Expressive and playful.", gender: "female", age: "young", providerVoiceId: "cgSgspJ2msm6clMCkdW9" },
  { id: "lily", label: "Lily", blurb: "Warm and composed, British.", gender: "female", age: "middle_aged", providerVoiceId: "pFZP5JQG7iQjIQuC4Bku" },
  { id: "roger", label: "Roger", blurb: "Confident and easy-going.", gender: "male", age: "middle_aged", providerVoiceId: "CwhRBWXzGAHq8TQ4Fs17" },
  { id: "charlie", label: "Charlie", blurb: "Natural and casual, Australian.", gender: "male", age: "young", providerVoiceId: "IKne3meq5aSn9XLyUdCD" },
  { id: "george", label: "George", blurb: "Warm storyteller, British.", gender: "male", age: "middle_aged", providerVoiceId: "JBFqnCBsd6RMkjVDRZzb" },
  { id: "callum", label: "Callum", blurb: "Intense, with a gravelly edge.", gender: "male", age: "middle_aged", providerVoiceId: "N2lVS1w4EtoT3dr4eOWO" },
  { id: "liam", label: "Liam", blurb: "Articulate and energetic.", gender: "male", age: "young", providerVoiceId: "TX3LPaxmHKxFdv7VOQHJ" },
  { id: "will", label: "Will", blurb: "Friendly and relaxed.", gender: "male", age: "young", providerVoiceId: "bIHbv24MWmeRgasZH58o" },
  { id: "eric", label: "Eric", blurb: "Friendly and conversational.", gender: "male", age: "middle_aged", providerVoiceId: "cjVigY5qzO86Huf0OWal" },
  { id: "chris", label: "Chris", blurb: "Natural and casual.", gender: "male", age: "middle_aged", providerVoiceId: "iP95p4xoKVk53GoZ742B" },
  { id: "brian", label: "Brian", blurb: "Deep and resonant narrator.", gender: "male", age: "middle_aged", providerVoiceId: "nPczCjzI2devNBz1zQrb" },
  { id: "daniel", label: "Daniel", blurb: "Authoritative, British.", gender: "male", age: "middle_aged", providerVoiceId: "onwK4e9ZLuTAKqWW03F9" },
  { id: "bill", label: "Bill", blurb: "Trustworthy and wise.", gender: "male", age: "old", providerVoiceId: "pqHfZKP75CvOlQylNhV4" },
  { id: "river", label: "River", blurb: "Calm and relaxed, neutral.", gender: "neutral", age: "middle_aged", providerVoiceId: "SAz9YHcvj6GT2YYXdXww" },
];

/**
 * ElevenLabs' own labels → our vocabulary. The API's `labels` object names
 * gender as "female" | "male" | "non-binary"/"neutral" and age as "young" |
 * "middle-aged" | "old" (with variants); anything else is the neutral /
 * middle-aged default rather than a guess.
 */
export function voiceGenderFromLabel(v: unknown): VoiceGender {
  const s = String(v ?? "").toLowerCase();
  if (s === "female") return "female";
  if (s === "male") return "male";
  return "neutral";
}
export function voiceAgeFromLabel(v: unknown): VoiceAge {
  const s = String(v ?? "").toLowerCase().replace(/[\s_]+/g, "-");
  if (s === "young") return "young";
  if (s === "old" || s === "older" || s === "elderly") return "old";
  return "middle_aged";
}
