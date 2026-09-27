/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  HOW A VOICE IS DELIVERED — the settings we had never been sending
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-27: "i test the text to speech now and i think is not
 * realistic enough, sounds like ai, isnt it the realistic multilingual v2 and
 * v3?"
 *
 * ── 🔴 THE MODEL WAS NEVER THE PROBLEM ──────────────────────────────────────
 *
 * It was v3. The live settings row (probed 2026-09-27) had Text to Audio on
 * `eleven_v3` through the direct API and Voice Replace on `elevenlabs/v3`
 * through Replicate. What made it sound like a reading was that BOTH adapters
 * sent the text, the model and nothing else:
 *
 *   lib/ai/voice/elevenlabs.ts        `{ text, model_id }`
 *   lib/ai/voice/tts-provider.ts     "Nothing else is sent — stability,
 *                                     style and speed stay the model's
 *                                     defaults."
 *
 * ElevenLabs' defaults are deliberately conservative: middling stability and
 * **style at zero**. Style is the expressiveness dial. At zero, a perfect
 * model reads a sentence the way a screen reader does — every clause the same
 * length, no lift, no hesitation. That is the "sounds like AI" the owner
 * heard, and no change of model fixes it, because every model in the family
 * has the same flat default.
 *
 * ── 🔴 THE MODELS DO NOT TAKE THE SAME NUMBERS ──────────────────────────────
 *
 * This is why the values live here and not in a config normaliser:
 *
 *   v3                 `stability` is a CHOICE OF THREE — 0.0 Creative,
 *                      0.5 Natural, 1.0 Robust. A value in between is not a
 *                      finer setting, it is a rejected request. v3 also
 *                      ignores `style`; its expression comes from the
 *                      stability choice and from audio tags in the text.
 *   Multilingual v2    the full 0–1 range for `stability` and `similarity_
 *                      boost`, plus `style` (the dial that was off) and
 *                      `use_speaker_boost`.
 *   Turbo / Flash v2.5 as v2, and they also take `speed`.
 *
 * So `clampVoiceSettings` is not defensive tidying — it is the difference
 * between an expressive generation and a 422. Every caller goes through it,
 * and a value a model does not accept is DROPPED rather than rounded: sending
 * `style` to v3 would be sending a field it does not read, and rounding a
 * v3 stability of 0.35 to 0.5 silently would mean the operator's setting and
 * the audio disagree.
 *
 * ── Why presets, not sliders, reach the member ──────────────────────────────
 *
 * A member asking for a voiceover does not know what similarity boost is, and
 * four numbers in a browser body are four numbers a caller can invent. The
 * interface offers NAMES; the server maps a name to numbers from the
 * operator's configuration. Nothing numeric is ever trusted from a client.
 */

export type TtsDelivery = "natural" | "expressive" | "calm";
export const TTS_DELIVERIES: readonly TtsDelivery[] = ["natural", "expressive", "calm"];

/** Member-facing words, and what each one is for. No provider term, no number. */
export const TTS_DELIVERY_LABEL: Record<TtsDelivery, { label: string; blurb: string }> = {
  natural: { label: "Natural", blurb: "Conversational and steady — the everyday choice." },
  expressive: { label: "Expressive", blurb: "More lift and emotion. Best for ads and storytelling." },
  calm: { label: "Calm", blurb: "Even and measured. Best for long narration." },
};

export interface TtsVoiceSettings {
  /** 0 = most variation and emotion, 1 = most consistent. v3 takes only 0, 0.5 or 1. */
  stability: number;
  /** How closely the voice sticks to its reference. High is faithful; very high can carry the reference's artefacts. */
  similarityBoost: number;
  /** The expressiveness dial. 0 is a reading. Not read by v3. */
  style: number;
  /** Provider's loudness/clarity pass toward the reference voice. Not read by v3. */
  speakerBoost: boolean;
  /** 0.7–1.2. Only Turbo/Flash v2.5 accept it. */
  speed: number;
}

/**
 * The defaults, chosen for the complaint above rather than for the provider's
 * caution. `style: 0.35` is the change that matters most; `stability: 0.45`
 * sits just below the midpoint so clauses vary in length and stress, which is
 * most of what "human" is in a sentence.
 *
 * ⚠️ Higher style is not better: past ~0.6 the voice starts performing, and on
 * long text it drifts. 0.35 is expressive on a sentence and still steady over
 * a paragraph.
 */
export const TTS_VOICE_SETTINGS_DEFAULTS: TtsVoiceSettings = {
  stability: 0.45,
  similarityBoost: 0.8,
  style: 0.35,
  speakerBoost: true,
  speed: 1,
};

/** The three presets, as offsets from whatever the operator configured — so an operator's tuning moves all three together. */
export const TTS_DELIVERY_PRESETS: Record<TtsDelivery, { stability: number; style: number }> = {
  // the v3 stability choices are 0 / 0.5 / 1, and these three map cleanly onto them
  expressive: { stability: 0.3, style: 0.55 },
  natural: { stability: 0.45, style: 0.35 },
  calm: { stability: 0.7, style: 0.15 },
};

export function isTtsDelivery(v: unknown): v is TtsDelivery {
  return typeof v === "string" && (TTS_DELIVERIES as readonly string[]).includes(v);
}

/** The operator's settings, moved to the member's chosen delivery. Pure. */
export function voiceSettingsForDelivery(base: TtsVoiceSettings, delivery: TtsDelivery | null): TtsVoiceSettings {
  if (!delivery) return base;
  const preset = TTS_DELIVERY_PRESETS[delivery];
  return { ...base, stability: preset.stability, style: preset.style };
}

/**
 * What one model actually reads. The three families differ, and a field a
 * model does not read is left out rather than sent and ignored — the settings
 * recorded on the job row are then exactly what the provider was told.
 */
export interface VoiceSettingsCapability {
  /** v3: the only three values it accepts. Empty = the continuous 0–1 range. */
  stabilityChoices: readonly number[];
  style: boolean;
  speakerBoost: boolean;
  speed: boolean;
}

const V3_CAPABILITY: VoiceSettingsCapability = { stabilityChoices: [0, 0.5, 1], style: false, speakerBoost: false, speed: false };
const V2_CAPABILITY: VoiceSettingsCapability = { stabilityChoices: [], style: true, speakerBoost: true, speed: false };
const V2_5_CAPABILITY: VoiceSettingsCapability = { stabilityChoices: [], style: true, speakerBoost: true, speed: true };

/**
 * Which capability a model id has — the DIRECT api's `model_id`, or the
 * Replicate model name, since the Replicate wrappers expose the same dials.
 */
export function voiceSettingsCapability(model: string): VoiceSettingsCapability {
  const m = model.toLowerCase();
  if (m.includes("v3")) return m.includes("2.5") || m.includes("v2_5") ? V2_5_CAPABILITY : V3_CAPABILITY;
  if (m.includes("turbo") || m.includes("flash")) return V2_5_CAPABILITY;
  return V2_CAPABILITY;
}

const clamp01 = (n: number, d: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : d);

/** The nearest value a model with a discrete stability actually accepts. */
export function nearestStability(value: number, choices: readonly number[]): number {
  let best = choices[0] ?? 0.5;
  for (const c of choices) if (Math.abs(c - value) < Math.abs(best - value)) best = c;
  return best;
}

export interface ClampedVoiceSettings {
  stability: number;
  similarity_boost: number;
  style?: number;
  use_speaker_boost?: boolean;
  speed?: number;
}

/**
 * The settings as one model will take them. Returns the provider's own field
 * names because this object goes straight into a request body and onto the
 * job row — one shape, so what was sent and what was recorded cannot drift.
 */
export function clampVoiceSettings(settings: TtsVoiceSettings, model: string): ClampedVoiceSettings {
  const cap = voiceSettingsCapability(model);
  const stability = clamp01(settings.stability, TTS_VOICE_SETTINGS_DEFAULTS.stability);
  const out: ClampedVoiceSettings = {
    stability: cap.stabilityChoices.length ? nearestStability(stability, cap.stabilityChoices) : Math.round(stability * 100) / 100,
    similarity_boost: Math.round(clamp01(settings.similarityBoost, TTS_VOICE_SETTINGS_DEFAULTS.similarityBoost) * 100) / 100,
  };
  if (cap.style) out.style = Math.round(clamp01(settings.style, TTS_VOICE_SETTINGS_DEFAULTS.style) * 100) / 100;
  if (cap.speakerBoost) out.use_speaker_boost = settings.speakerBoost !== false;
  if (cap.speed) {
    const speed = Number.isFinite(settings.speed) ? Math.min(1.2, Math.max(0.7, settings.speed)) : 1;
    // 1 is the model's own default; sending it adds a field that changes nothing
    if (speed !== 1) out.speed = Math.round(speed * 100) / 100;
  }
  return out;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown, d: number, min: number, max: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(Math.min(max, Math.max(min, n)) * 100) / 100 : d;
};

/** An operator's saved block, normalised. Shared by every tool's config normaliser. */
export function normalizeTtsVoiceSettings(raw: unknown, defaults: TtsVoiceSettings = TTS_VOICE_SETTINGS_DEFAULTS): TtsVoiceSettings {
  const r = isRecord(raw) ? raw : {};
  return {
    stability: num(r.stability, defaults.stability, 0, 1),
    similarityBoost: num(r.similarityBoost, defaults.similarityBoost, 0, 1),
    style: num(r.style, defaults.style, 0, 1),
    speakerBoost: typeof r.speakerBoost === "boolean" ? r.speakerBoost : defaults.speakerBoost,
    speed: num(r.speed, defaults.speed, 0.7, 1.2),
  };
}
