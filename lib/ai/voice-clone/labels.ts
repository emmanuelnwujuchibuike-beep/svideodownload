/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE VOICE'S OWN DESCRIPTION — language, accent, gender, age
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-27, with a screenshot of ElevenLabs' own Instant Voice Clone
 * form: "The voice cloning still isn't accurate like the main eleven lab in my
 * screenshot that has full Control of the voice cloning."
 *
 * Their form asks for four things before it saves a voice — Language, Accent,
 * Gender, Age — plus a description. This product asked for none of them and
 * sent the vendor two labels of its own bookkeeping (`source`, `owner`), which
 * is why a Nigerian voice arrived as an unlabelled clone.
 *
 * ── 🔴 WHAT LABELS DO, HONESTLY ─────────────────────────────────────────────
 *
 * The ACCENT itself is learned from the recordings — instant cloning copies
 * what it hears, and no dropdown changes that. What the labels do is describe
 * the voice TO THE PROVIDER and to the member: they are stored on the voice,
 * shown in the voice list, and used by the provider's own tooling to pick and
 * present voices. Sending them is parity with the vendor's form and makes the
 * library legible; it is not a knob that reshapes the audio, and this file does
 * not pretend otherwise.
 *
 * Pure: the option lists are shared by the browser's selects and the server's
 * validation, so a value the interface offers is exactly a value the server
 * accepts. Nothing here reaches a network.
 */

export interface VoiceCloneLabelOption {
  value: string;
  label: string;
}

/**
 * The accents ElevenLabs recognises for English, with the ones this product's
 * members actually use first. `nigerian` is in the vendor's own list (it is the
 * one the owner picked in the screenshot) and leads the African group.
 */
export const VOICE_CLONE_ACCENTS: readonly VoiceCloneLabelOption[] = [
  { value: "nigerian", label: "Nigerian" },
  { value: "african", label: "African (other)" },
  { value: "ghanaian", label: "Ghanaian" },
  { value: "south_african", label: "South African" },
  { value: "kenyan", label: "Kenyan" },
  { value: "american", label: "American" },
  { value: "british", label: "British" },
  { value: "australian", label: "Australian" },
  { value: "canadian", label: "Canadian" },
  { value: "irish", label: "Irish" },
  { value: "scottish", label: "Scottish" },
  { value: "indian", label: "Indian" },
  { value: "caribbean", label: "Caribbean" },
  { value: "jamaican", label: "Jamaican" },
  { value: "filipino", label: "Filipino" },
  { value: "french", label: "French" },
  { value: "german", label: "German" },
  { value: "italian", label: "Italian" },
  { value: "spanish", label: "Spanish" },
  { value: "portuguese", label: "Portuguese" },
  { value: "arabic", label: "Arabic" },
  { value: "neutral", label: "Neutral / none" },
];

/** The vendor's own vocabulary, matching the words already used across this codebase. */
export const VOICE_CLONE_GENDERS: readonly VoiceCloneLabelOption[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "neutral", label: "Neutral" },
];

export const VOICE_CLONE_AGES: readonly VoiceCloneLabelOption[] = [
  { value: "young", label: "Young" },
  { value: "middle_aged", label: "Middle aged" },
  { value: "old", label: "Older" },
];

/**
 * The languages offered on the cloning form. A clone speaks every language the
 * model does — this names the one the RECORDINGS are in, which is what the
 * vendor's form asks for and what makes the voice findable later.
 */
export const VOICE_CLONE_LANGUAGES: readonly VoiceCloneLabelOption[] = [
  { value: "en", label: "English" },
  { value: "pcm", label: "Nigerian Pidgin" },
  { value: "yo", label: "Yoruba" },
  { value: "ig", label: "Igbo" },
  { value: "ha", label: "Hausa" },
  { value: "sw", label: "Swahili" },
  { value: "fr", label: "French" },
  { value: "es", label: "Spanish" },
  { value: "pt", label: "Portuguese" },
  { value: "ar", label: "Arabic" },
  { value: "hi", label: "Hindi" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "zh", label: "Chinese" },
];

export interface VoiceCloneLabels {
  language: string | null;
  accent: string | null;
  gender: string | null;
  age: string | null;
}

export const EMPTY_VOICE_CLONE_LABELS: VoiceCloneLabels = { language: null, accent: null, gender: null, age: null };

const allowed = (options: readonly VoiceCloneLabelOption[], value: unknown): string | null =>
  typeof value === "string" && options.some((o) => o.value === value) ? value : null;

/**
 * A member's chosen labels, each one checked against the list the interface
 * offered. Anything else becomes null rather than travelling to the vendor —
 * these end up on a voice that is a real person's likeness, and a free-text
 * field there is a free-text field on somebody's identity.
 */
export function normalizeVoiceCloneLabels(raw: unknown): VoiceCloneLabels {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    language: allowed(VOICE_CLONE_LANGUAGES, r.language),
    accent: allowed(VOICE_CLONE_ACCENTS, r.accent),
    gender: allowed(VOICE_CLONE_GENDERS, r.gender),
    age: allowed(VOICE_CLONE_AGES, r.age),
  };
}

/**
 * The labels as the provider takes them: its own key names, only the ones the
 * member actually set, plus the two this product keeps for its operator so a
 * member's clone is tellable from a library voice on the account.
 */
export function providerLabels(labels: VoiceCloneLabels, ownerTag: string): Record<string, string> {
  const out: Record<string, string> = { source: "frenz-ai", owner: ownerTag };
  if (labels.language) out.language = labels.language;
  if (labels.accent) out.accent = labels.accent;
  if (labels.gender) out.gender = labels.gender;
  if (labels.age) out.age = labels.age;
  return out;
}

/** "Nigerian · Male · Middle aged" — what the library row shows under the name. */
export function describeVoiceCloneLabels(labels: VoiceCloneLabels): string {
  const find = (options: readonly VoiceCloneLabelOption[], v: string | null) => options.find((o) => o.value === v)?.label ?? null;
  return [find(VOICE_CLONE_ACCENTS, labels.accent), find(VOICE_CLONE_GENDERS, labels.gender), find(VOICE_CLONE_AGES, labels.age)].filter(Boolean).join(" · ");
}
