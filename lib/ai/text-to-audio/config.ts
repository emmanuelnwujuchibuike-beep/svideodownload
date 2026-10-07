import { isTtsDelivery, normalizeTtsVoiceSettings, TTS_VOICE_SETTINGS_DEFAULTS, type TtsDelivery, type TtsVoiceSettings } from "@/lib/ai/voice/voice-settings";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  TEXT TO AUDIO — the operator's configuration (pure)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-21: "Create a dedicated Text to Audio tool … ElevenLabs V3
 * through Replicate … its own billing … admin-configurable pricing … the
 * text to speech should also switch to the Replicate ElevenLabs v3 or the
 * direct ElevenLabs API in the admin dashboard … a free 500 characters a
 * month for free and all sub users."
 *
 * Stored under ONE key of the landing settings row (`frenzAiTextToAudio`).
 *
 * ── The two routes (both ElevenLabs, both already adapters) ────────────────
 *   replicate   `elevenlabs/v3` (and the other Replicate ElevenLabs models):
 *               an async prediction, the webhook, the worker stores the MP3
 *   elevenlabs  `elevenlabs/eleven_v3` (and v2/turbo/flash): the direct API,
 *               synchronous — the audio is made and stored in the request
 * The switch is `route`; the model within each route is `models[route]`.
 * ElevenLabs is the only vendor either way (the fal.ai brief §17).
 */
export type TextToAudioRoute = "replicate" | "elevenlabs";
export const TEXT_TO_AUDIO_ROUTES: readonly TextToAudioRoute[] = ["replicate", "elevenlabs"];

/** The model ids each route accepts — the adapters' own registries (lib/ai/voice/elevenlabs-models.ts). */
export const TEXT_TO_AUDIO_MODEL_IDS: Record<TextToAudioRoute, readonly string[]> = {
  replicate: ["elevenlabs/v3", "elevenlabs/v2-multilingual", "elevenlabs/turbo-v2.5", "elevenlabs/flash-v2.5"],
  elevenlabs: ["elevenlabs/eleven_v4", "elevenlabs/eleven_v4_turbo", "elevenlabs/eleven_v3", "elevenlabs/eleven_multilingual_v2", "elevenlabs/eleven_turbo_v2_5", "elevenlabs/eleven_flash_v2_5"],
};

export interface TextToAudioModelChoice {
  model: string;
  enabled: boolean;
  /** The member's price per character, in minor units of the AI currency (fractions allowed: 0.5 = half a cent). */
  perCharacterCents: number;
  /** A flat amount per generation. */
  perRequestCents: number;
  /** The operator's provider-cost figure, US cents per character (the estimate; 0 = unknown). */
  providerCostPerCharacterUsdCents: number;
  /** §2: "applicable quality/settings multiplier" on the customer price. */
  qualityMultiplier: number;
  creditMultiplier: number;
  notes: string;
}

export interface TextToAudioConfig {
  enabled: boolean;
  route: TextToAudioRoute;
  models: Record<TextToAudioRoute, TextToAudioModelChoice>;
  /** §2: the least any paid generation costs. */
  minimumChargeCents: number;
  /** The most characters one generation may carry (the model's own ceiling still applies). */
  maximumCharacters: number;
  minimumCharacters: number;
  /** The monthly free allowance in characters — for free members AND every plan (owner). 0 = none. */
  freeCharactersPerMonth: number;
  /** Catalogue voice ids offered (Character Replace's catalogue); empty = every voice of the active route's provider. */
  voiceIds: readonly string[];
  languageCodes: readonly string[];
  /** How long a saved audio asset is kept; 0 = for ever. */
  libraryRetentionDays: number;
  /**
   * 🔴 2026-09-27 — THE SETTINGS THAT WERE NEVER SENT.
   *
   * Owner: "i test the text to speech now and i think is not realistic
   * enough, sounds like ai." It was v3; what was missing was this. Until this
   * field existed every generation ran at the provider's own defaults, with
   * the expressiveness dial at zero. lib/ai/voice/voice-settings.ts explains
   * which model reads which of these numbers.
   */
  voiceSettings: TtsVoiceSettings;
  /** Whether a member may choose Natural / Expressive / Calm. Off = every generation uses the numbers above. */
  deliveryChoice: boolean;
  /** What a member gets when they choose nothing (and what everyone gets when the choice is off). */
  defaultDelivery: TtsDelivery;
  pricingVersion: number;
  pricingUpdatedAt: string | null;
  version: number;
  updatedAt: string | null;
}

export const TEXT_TO_AUDIO_BOUNDS = {
  perCharacterCents: { min: 0, max: 100_000 },
  cents: { min: 0, max: 100_000_000 },
  providerCostUsdCents: { min: 0, max: 1000 },
  multiplier: { min: 0.1, max: 10 },
  characters: { min: 1, max: 40_000 },
  freeCharacters: { min: 0, max: 1_000_000 },
  retentionDays: { min: 0, max: 3650 },
} as const;

const model = (id: string, notes: string): TextToAudioModelChoice => ({ model: id, enabled: true, perCharacterCents: 0.5, perRequestCents: 0, providerCostPerCharacterUsdCents: 0, qualityMultiplier: 1, creditMultiplier: 1, notes });

export const TEXT_TO_AUDIO_DEFAULTS: TextToAudioConfig = {
  enabled: true,
  /*
    2026-09-27 (owner): no new Replicate or fal.ai integration — the direct
    ElevenLabs API is the default route for this tool. The Replicate route
    stays selectable until the provider migration lands, and nothing is
    built on it from here.
  */
  route: "elevenlabs",
  models: {
    replicate: model("elevenlabs/v3", "ElevenLabs v3 through Replicate — an async prediction; the 26 named voices."),
    /*
      🔴 v4 (owner, 2026-10-04: "use their most latest and best model
      suitable"). The QUALITY model, not Turbo: nothing in Text to Audio is a
      live conversation, so v4 Turbo's ~150 ms latency buys nothing here and
      expressiveness is the whole product. Turbo stays selectable above for an
      operator who wants it.
    */
    elevenlabs: model("elevenlabs/eleven_v4", "ElevenLabs v4 through the direct API — the newest and most expressive; synchronous."),
  },
  minimumChargeCents: 0,
  maximumCharacters: 5_000,
  minimumCharacters: 1,
  freeCharactersPerMonth: 500,
  voiceIds: [],
  languageCodes: [],
  libraryRetentionDays: 0,
  voiceSettings: TTS_VOICE_SETTINGS_DEFAULTS,
  deliveryChoice: true,
  defaultDelivery: "natural",
  pricingVersion: 1,
  pricingUpdatedAt: null,
  version: 1,
  updatedAt: null,
};

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const num = (v: unknown, d: number, min: number, max: number, round = false) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return d;
  const c = Math.min(max, Math.max(min, n));
  return round ? Math.round(c) : Math.round(c * 1000) / 1000;
};
const int = (v: unknown, d: number, min: number, max: number) => num(v, d, min, max, true);
const text = (v: unknown, d: string, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : d);
const ids = (v: unknown, d: readonly string[]): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^[A-Za-z0-9_\-./:]{1,80}$/.test(x)).slice(0, 200) : [...d]);

function normalizeModel(raw: unknown, d: TextToAudioModelChoice, route: TextToAudioRoute): TextToAudioModelChoice {
  const r = isRecord(raw) ? raw : {};
  return {
    model: typeof r.model === "string" && TEXT_TO_AUDIO_MODEL_IDS[route].includes(r.model.trim()) ? r.model.trim() : d.model,
    enabled: bool(r.enabled, d.enabled),
    perCharacterCents: num(r.perCharacterCents, d.perCharacterCents, TEXT_TO_AUDIO_BOUNDS.perCharacterCents.min, TEXT_TO_AUDIO_BOUNDS.perCharacterCents.max),
    perRequestCents: int(r.perRequestCents, d.perRequestCents, TEXT_TO_AUDIO_BOUNDS.cents.min, TEXT_TO_AUDIO_BOUNDS.cents.max),
    providerCostPerCharacterUsdCents: num(r.providerCostPerCharacterUsdCents, d.providerCostPerCharacterUsdCents, TEXT_TO_AUDIO_BOUNDS.providerCostUsdCents.min, TEXT_TO_AUDIO_BOUNDS.providerCostUsdCents.max),
    qualityMultiplier: num(r.qualityMultiplier, d.qualityMultiplier, TEXT_TO_AUDIO_BOUNDS.multiplier.min, TEXT_TO_AUDIO_BOUNDS.multiplier.max),
    creditMultiplier: num(r.creditMultiplier, d.creditMultiplier, TEXT_TO_AUDIO_BOUNDS.multiplier.min, TEXT_TO_AUDIO_BOUNDS.multiplier.max),
    notes: text(r.notes, d.notes, 400),
  };
}

export function normalizeTextToAudioConfig(raw: unknown): TextToAudioConfig {
  const d = TEXT_TO_AUDIO_DEFAULTS;
  if (!isRecord(raw)) return d;
  const models = isRecord(raw.models) ? raw.models : {};
  const minChars = int(raw.minimumCharacters, d.minimumCharacters, TEXT_TO_AUDIO_BOUNDS.characters.min, TEXT_TO_AUDIO_BOUNDS.characters.max);
  return {
    enabled: bool(raw.enabled, d.enabled),
    /*
      ⛔ ALWAYS the direct ElevenLabs API (Part 8 §42, §71 — 2026-10-05). The
      stored switch could still say "replicate", and `generate.ts` would then
      have sent real member jobs through Replicate. Whatever is stored, the
      route is ElevenLabs; the admin save route refuses anything else too.
    */
    route: "elevenlabs",
    models: { replicate: normalizeModel(models.replicate, d.models.replicate, "replicate"), elevenlabs: normalizeModel(models.elevenlabs, d.models.elevenlabs, "elevenlabs") },
    minimumChargeCents: int(raw.minimumChargeCents, d.minimumChargeCents, TEXT_TO_AUDIO_BOUNDS.cents.min, TEXT_TO_AUDIO_BOUNDS.cents.max),
    maximumCharacters: Math.max(minChars, int(raw.maximumCharacters, d.maximumCharacters, TEXT_TO_AUDIO_BOUNDS.characters.min, TEXT_TO_AUDIO_BOUNDS.characters.max)),
    minimumCharacters: minChars,
    freeCharactersPerMonth: int(raw.freeCharactersPerMonth, d.freeCharactersPerMonth, TEXT_TO_AUDIO_BOUNDS.freeCharacters.min, TEXT_TO_AUDIO_BOUNDS.freeCharacters.max),
    voiceIds: ids(raw.voiceIds, d.voiceIds),
    languageCodes: ids(raw.languageCodes, d.languageCodes),
    libraryRetentionDays: int(raw.libraryRetentionDays, d.libraryRetentionDays, TEXT_TO_AUDIO_BOUNDS.retentionDays.min, TEXT_TO_AUDIO_BOUNDS.retentionDays.max),
    voiceSettings: normalizeTtsVoiceSettings(raw.voiceSettings, d.voiceSettings),
    deliveryChoice: bool(raw.deliveryChoice, d.deliveryChoice),
    defaultDelivery: isTtsDelivery(raw.defaultDelivery) ? raw.defaultDelivery : d.defaultDelivery,
    pricingVersion: int(raw.pricingVersion, d.pricingVersion, 1, 1_000_000_000),
    pricingUpdatedAt: typeof raw.pricingUpdatedAt === "string" ? raw.pricingUpdatedAt : null,
    version: int(raw.version, d.version, 1, 1_000_000_000),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
  };
}

const stable = (v: unknown): string => JSON.stringify(v, (_k, val) => (val && typeof val === "object" && !Array.isArray(val) ? Object.fromEntries(Object.keys(val as Record<string, unknown>).sort().map((k) => [k, (val as Record<string, unknown>)[k]])) : val));

export function textToAudioPricingFingerprint(c: TextToAudioConfig): string {
  return stable({ models: TEXT_TO_AUDIO_ROUTES.map((r) => [r, c.models[r].perCharacterCents, c.models[r].perRequestCents, c.models[r].qualityMultiplier, c.models[r].creditMultiplier]), minimum: c.minimumChargeCents, free: c.freeCharactersPerMonth });
}
export function textToAudioFingerprint(c: TextToAudioConfig): string {
  return stable({ enabled: c.enabled, route: c.route, models: TEXT_TO_AUDIO_ROUTES.map((r) => [r, c.models[r].model, c.models[r].enabled]), chars: [c.minimumCharacters, c.maximumCharacters], free: c.freeCharactersPerMonth, voices: c.voiceIds, languages: c.languageCodes, retention: c.libraryRetentionDays, delivery: [c.voiceSettings, c.deliveryChoice, c.defaultDelivery] });
}
export function versionTextToAudioConfig(previous: TextToAudioConfig, next: TextToAudioConfig, now: Date = new Date()): TextToAudioConfig {
  const priced = textToAudioPricingFingerprint(previous) !== textToAudioPricingFingerprint(next);
  const changed = priced || textToAudioFingerprint(previous) !== textToAudioFingerprint(next);
  return { ...next, pricingVersion: priced ? previous.pricingVersion + 1 : previous.pricingVersion, pricingUpdatedAt: priced ? now.toISOString() : previous.pricingUpdatedAt, version: changed ? previous.version + 1 : previous.version, updatedAt: changed ? now.toISOString() : previous.updatedAt };
}

/** The active model id — the switch decides the route, the route its model. */
export function activeTextToAudioModel(c: TextToAudioConfig): string {
  return c.models[c.route].model;
}

export interface TextToAudioPublicConfig {
  enabled: boolean;
  currency: string;
  symbol: string;
  minimumCharacters: number;
  maximumCharacters: number;
  freeCharactersPerMonth: number;
  /** "3 credits per 100 characters" — a sentence, server-formatted, in credits (0184). */
  priceLine: string | null;
  /** 2026-09-27: whether the workspace offers Natural / Expressive / Calm, and which one starts selected. */
  deliveryChoice: boolean;
  defaultDelivery: TtsDelivery;
  pricingVersion: number;
}

export function publicTextToAudioConfig(c: TextToAudioConfig, currency: { code: string; symbol: string }, usable: boolean, centsPerCredit = 10): TextToAudioPublicConfig {
  const m = c.models[c.route];
  const cpc = Math.max(1, centsPerCredit);
  // 0184: the rate in CREDITS per 100 characters (per character it is a fraction of a cent)
  const perHundred = (m.perCharacterCents * m.qualityMultiplier * m.creditMultiplier * 100) / cpc;
  const round = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);
  const perRequest = round((m.perRequestCents * m.creditMultiplier) / cpc);
  const priceLine = perHundred > 0 ? `${round(perHundred)} credit${round(perHundred) === 1 ? "" : "s"} per 100 characters` : perRequest > 0 ? `${perRequest} credit${perRequest === 1 ? "" : "s"} per generation` : null;
  return { enabled: c.enabled && usable, currency: currency.code, symbol: currency.symbol, minimumCharacters: c.minimumCharacters, maximumCharacters: c.maximumCharacters, freeCharactersPerMonth: c.freeCharactersPerMonth, priceLine, deliveryChoice: c.deliveryChoice, defaultDelivery: c.defaultDelivery, pricingVersion: c.pricingVersion };
}
