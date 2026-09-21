/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LIP SYNC PRO — the operator's configuration (pure: types, defaults, bounds,
 *  the normaliser, the public view)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-21: "Add a dedicated Lip Sync Pro capability … TWO distinct
 * input workflows: TEXT-TO-LIP-SYNC (text, voice, language, speed) and
 * EXTERNAL AUDIO (mp3/wav/m4a/aac/ogg) … mutually exclusive … a provider
 * abstraction with capability flags … the UI dynamically exposes only
 * capabilities supported by the currently configured provider … the same
 * centralized credit system … an admin AI → Lip Sync section."
 *
 * Stored under ONE key of the landing settings row (`frenzAiLipSync`),
 * merged on the way in and clamped on the way out, like the other AI configs.
 *
 * ── The models this build knows (schemas read LIVE on 2026-09-21) ──────────
 *
 *   replicate  kwaivgi/kling-lip-sync   video_url (mp4/mov, < 100 MB, 2–10 s,
 *              720–1920 px) + audio_file (mp3/wav/m4a/aac, < 5 MB) OR text +
 *              voice_id (Kling's own voices) + voice_speed 0.8–2.0  → TEXT-NATIVE
 *   replicate  sync/lipsync-2-pro, sync/lipsync-2   video (.mp4) + audio (.wav)
 *              + sync_mode + temperature 0–1 + active_speaker    → AUDIO ONLY
 *   fal        fal-ai/sync-lipsync/v3 (Sync-3)   video_url + audio_url + sync_mode
 *                                                                  → AUDIO ONLY
 *
 * The capability flags are declared by each adapter from its schema
 * (lib/ai/lip-sync/providers/*), never here — this file only names which
 * model the operator chose per vendor and which vendor is active.
 *
 * ── Text to Speech (§5, §17) ────────────────────────────────────────────────
 * A text-native model receives the text itself. Every other model receives
 * audio the worker made with the VOICE provider — ElevenLabs, locked (the
 * fal.ai brief §17) — through the same synthesis the Character Replace
 * voice step uses. The member experiences one generation either way.
 */

export type LipSyncVendor = "replicate" | "fal";
export type LipSyncExpression = "natural" | "balanced" | "expressive";
export const LIP_SYNC_EXPRESSIONS: readonly LipSyncExpression[] = ["natural", "balanced", "expressive"];
/** §7: what to do when the audio and the video differ in length. */
export type LipSyncDurationPolicy = "trim_video_to_audio" | "trim_audio_to_video" | "loop_audio" | "reject" | "provider_sync_mode";
export const LIP_SYNC_DURATION_POLICIES: readonly LipSyncDurationPolicy[] = ["trim_video_to_audio", "trim_audio_to_video", "loop_audio", "reject", "provider_sync_mode"];
export type LipSyncSpeechSource = "text" | "audio";

/** The audio containers the tool accepts from a member (§2). A provider that takes fewer gets a re-encoded WAV from the worker. */
export const LIP_SYNC_AUDIO_FORMATS: readonly { id: string; label: string; mimeTypes: readonly string[]; extensions: readonly string[] }[] = [
  { id: "mp3", label: "MP3", mimeTypes: ["audio/mpeg", "audio/mp3"], extensions: ["mp3"] },
  { id: "wav", label: "WAV", mimeTypes: ["audio/wav", "audio/x-wav", "audio/wave"], extensions: ["wav"] },
  { id: "m4a", label: "M4A", mimeTypes: ["audio/mp4", "audio/x-m4a", "audio/m4a"], extensions: ["m4a"] },
  { id: "aac", label: "AAC", mimeTypes: ["audio/aac", "audio/aacp"], extensions: ["aac"] },
  { id: "ogg", label: "OGG", mimeTypes: ["audio/ogg", "application/ogg"], extensions: ["ogg", "oga"] },
];

export interface LipSyncModelChoice {
  /** The model / endpoint id the adapter submits to. One of the ids the vendor's adapters know; anything else leaves the vendor unroutable. */
  model: string;
  enabled: boolean;
  /** The lip-sync rate the member pays, minor units of the AI currency per second of output. */
  perSecondCents: number;
  /** The operator's provider-cost figure, US cents per second (the estimate; 0 = unknown). */
  providerCostPerSecondUsdCents: number;
  creditMultiplier: number;
  /** An extra cap on runs in flight at this model; 0 = only the member/global caps. */
  maxConcurrent: number;
  notes: string;
}

export interface LipSyncProConfig {
  enabled: boolean;
  /** Which vendor runs NEW jobs (the fal.ai brief's switch, mirrored here for this tool). */
  provider: LipSyncVendor;
  models: Record<LipSyncVendor, LipSyncModelChoice>;
  /** The two speech sources, each switchable. */
  textMode: { enabled: boolean; minimumCharacters: number; maximumCharacters: number; speed: { min: number; max: number; default: number } };
  audioMode: { enabled: boolean; formats: readonly string[]; maximumDurationSeconds: number; maximumUploadBytes: number };
  video: { maximumDurationSeconds: number; minimumDurationSeconds: number; maximumUploadBytes: number; maximumPixels: number };
  /** §5: the voice provider for the text → audio path. LOCKED to ElevenLabs; the model is chosen from the Character Replace TTS catalogue's model list. */
  tts: { provider: "elevenlabs"; model: string; perRequestCents: number; perCharacterCents: number; providerCostPerCharacterUsdCents: number };
  /** Catalogue ids (Character Replace's voices/languages) offered here; empty = every enabled one. */
  voiceIds: readonly string[];
  languageCodes: readonly string[];
  /** §9: what the three presets mean to a provider with a temperature knob. */
  expression: { enabled: boolean; default: LipSyncExpression; temperature: Record<LipSyncExpression, number> };
  activeSpeaker: { enabled: boolean; default: boolean };
  /** §7: the mismatch policy, and the residual sync mode a provider is told. */
  duration: { policy: LipSyncDurationPolicy; significantMismatchFraction: number; providerSyncMode: "silence" | "loop" | "bounce" };
  /** A flat amount added to every job; the least any job costs. */
  basePriceCents: number;
  minimumChargeCents: number;
  pricingVersion: number;
  pricingUpdatedAt: string | null;
  version: number;
  updatedAt: string | null;
}

export const LIP_SYNC_MODEL_IDS: Record<LipSyncVendor, readonly string[]> = {
  replicate: ["sync/lipsync-2-pro", "sync/lipsync-2", "kwaivgi/kling-lip-sync"],
  fal: ["fal-ai/sync-lipsync/v3"],
};
/**
 * Owner, 2026-09-21: "use the fal.ai top lip sync model — Sync-3 or higher".
 * Sync-3 (`fal-ai/sync-lipsync/v3`, $8/min on 09-21) is the highest Sync Labs
 * model fal.ai serves today; a later `/v3.5`, `/v4` or `/pro` endpoint with
 * the same video_url + audio_url + sync_mode contract is accepted by this
 * pattern the day it ships — typed into AI → Lip Sync, no deploy.
 */
export const FAL_SYNC_LIPSYNC_PATTERN = /^fal-ai\/sync-lipsync\/v(?:[3-9]|[1-9]\d)(?:\.\d+)?(?:\/pro)?$/;
export function isAllowedLipSyncModel(vendor: LipSyncVendor, model: string): boolean {
  if (vendor === "fal") return FAL_SYNC_LIPSYNC_PATTERN.test(model);
  return LIP_SYNC_MODEL_IDS.replicate.includes(model);
}

export const LIP_SYNC_BOUNDS = {
  perSecondCents: { min: 0, max: 100_000_000 },
  providerCostUsdCents: { min: 0, max: 100_000 },
  creditMultiplier: { min: 0.1, max: 10 },
  maxConcurrent: { min: 0, max: 100 },
  characters: { min: 1, max: 5_000 },
  speed: { min: 0.5, max: 3 },
  videoSeconds: { min: 1, max: 120 },
  audioSeconds: { min: 1, max: 600 },
  uploadBytes: { min: 1024 * 1024, max: 100 * 1024 * 1024 },
  pixels: { min: 320 * 240, max: 3840 * 2160 },
  temperature: { min: 0, max: 1 },
  mismatch: { min: 0, max: 1 },
  cents: { min: 0, max: 100_000_000 },
} as const;

const modelDefault = (model: string, perSecondCents: number, notes: string): LipSyncModelChoice => ({
  model,
  enabled: true,
  perSecondCents,
  providerCostPerSecondUsdCents: 0,
  creditMultiplier: 1,
  maxConcurrent: 0,
  notes,
});

export const LIP_SYNC_DEFAULTS: LipSyncProConfig = {
  enabled: true,
  provider: "replicate",
  models: {
    // Sync Labs' studio model — the tier Character Replace already calls "Studio"; audio-driven, temperature + active speaker
    replicate: modelDefault("sync/lipsync-2-pro", 25, "sync/lipsync-2-pro (audio-driven, expression + active speaker) · sync/lipsync-2 (audio-driven) · kwaivgi/kling-lip-sync (text-native, Kling voices, 2–10 s, 720–1920 px)"),
    fal: { ...modelDefault("fal-ai/sync-lipsync/v3", 25, "Sync-3 on fal.ai ($8/min listed 2026-09-21): audio-driven; text becomes ElevenLabs speech first. A newer fal-ai/sync-lipsync/v… endpoint may be typed here."), providerCostPerSecondUsdCents: 13.33 },
  },
  textMode: { enabled: true, minimumCharacters: 1, maximumCharacters: 1_200, speed: { min: 0.8, max: 2.0, default: 1.0 } },
  audioMode: { enabled: true, formats: ["mp3", "wav", "m4a", "aac", "ogg"], maximumDurationSeconds: 120, maximumUploadBytes: 25 * 1024 * 1024 },
  video: { maximumDurationSeconds: 60, minimumDurationSeconds: 1, maximumUploadBytes: 50 * 1024 * 1024, maximumPixels: 1920 * 1080 },
  tts: { provider: "elevenlabs", model: "elevenlabs/eleven_v3", perRequestCents: 0, perCharacterCents: 0, providerCostPerCharacterUsdCents: 0 },
  voiceIds: [],
  languageCodes: [],
  expression: { enabled: true, default: "balanced", temperature: { natural: 0.3, balanced: 0.5, expressive: 0.8 } },
  activeSpeaker: { enabled: true, default: false },
  duration: { policy: "provider_sync_mode", significantMismatchFraction: 0.15, providerSyncMode: "silence" },
  basePriceCents: 0,
  minimumChargeCents: 0,
  pricingVersion: 1,
  pricingUpdatedAt: null,
  version: 1,
  updatedAt: null,
};

/* ───────────────────────────── the normaliser ────────────────────────────── */

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
const ids = (v: unknown, d: readonly string[], max = 200): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^[A-Za-z0-9_\-./:]{1,80}$/.test(x)).slice(0, max) : [...d]);

function normalizeModel(raw: unknown, d: LipSyncModelChoice, vendor: LipSyncVendor): LipSyncModelChoice {
  const r = isRecord(raw) ? raw : {};
  const model = typeof r.model === "string" && isAllowedLipSyncModel(vendor, r.model.trim()) ? r.model.trim() : d.model;
  return {
    model,
    enabled: bool(r.enabled, d.enabled),
    perSecondCents: int(r.perSecondCents, d.perSecondCents, LIP_SYNC_BOUNDS.perSecondCents.min, LIP_SYNC_BOUNDS.perSecondCents.max),
    providerCostPerSecondUsdCents: num(r.providerCostPerSecondUsdCents, d.providerCostPerSecondUsdCents, LIP_SYNC_BOUNDS.providerCostUsdCents.min, LIP_SYNC_BOUNDS.providerCostUsdCents.max),
    creditMultiplier: num(r.creditMultiplier, d.creditMultiplier, LIP_SYNC_BOUNDS.creditMultiplier.min, LIP_SYNC_BOUNDS.creditMultiplier.max),
    maxConcurrent: int(r.maxConcurrent, d.maxConcurrent, LIP_SYNC_BOUNDS.maxConcurrent.min, LIP_SYNC_BOUNDS.maxConcurrent.max),
    notes: text(r.notes, d.notes, 400),
  };
}

export function normalizeLipSyncConfig(raw: unknown): LipSyncProConfig {
  const d = LIP_SYNC_DEFAULTS;
  if (!isRecord(raw)) return d;
  const models = isRecord(raw.models) ? raw.models : {};
  const tm = isRecord(raw.textMode) ? raw.textMode : {};
  const speed = isRecord(tm.speed) ? tm.speed : {};
  const am = isRecord(raw.audioMode) ? raw.audioMode : {};
  const video = isRecord(raw.video) ? raw.video : {};
  const tts = isRecord(raw.tts) ? raw.tts : {};
  const ex = isRecord(raw.expression) ? raw.expression : {};
  const temp = isRecord(ex.temperature) ? ex.temperature : {};
  const as = isRecord(raw.activeSpeaker) ? raw.activeSpeaker : {};
  const du = isRecord(raw.duration) ? raw.duration : {};
  const minChars = int(tm.minimumCharacters, d.textMode.minimumCharacters, LIP_SYNC_BOUNDS.characters.min, LIP_SYNC_BOUNDS.characters.max);
  const speedMin = num(speed.min, d.textMode.speed.min, LIP_SYNC_BOUNDS.speed.min, LIP_SYNC_BOUNDS.speed.max);
  const speedMax = Math.max(speedMin, num(speed.max, d.textMode.speed.max, LIP_SYNC_BOUNDS.speed.min, LIP_SYNC_BOUNDS.speed.max));
  const minVideo = int(video.minimumDurationSeconds, d.video.minimumDurationSeconds, LIP_SYNC_BOUNDS.videoSeconds.min, LIP_SYNC_BOUNDS.videoSeconds.max);
  const formats = ids(am.formats, d.audioMode.formats).filter((f) => LIP_SYNC_AUDIO_FORMATS.some((k) => k.id === f));
  return {
    enabled: bool(raw.enabled, d.enabled),
    provider: raw.provider === "fal" ? "fal" : "replicate",
    models: { replicate: normalizeModel(models.replicate, d.models.replicate, "replicate"), fal: normalizeModel(models.fal, d.models.fal, "fal") },
    textMode: {
      enabled: bool(tm.enabled, d.textMode.enabled),
      minimumCharacters: minChars,
      maximumCharacters: Math.max(minChars, int(tm.maximumCharacters, d.textMode.maximumCharacters, LIP_SYNC_BOUNDS.characters.min, LIP_SYNC_BOUNDS.characters.max)),
      speed: { min: speedMin, max: speedMax, default: Math.min(speedMax, Math.max(speedMin, num(speed.default, d.textMode.speed.default, LIP_SYNC_BOUNDS.speed.min, LIP_SYNC_BOUNDS.speed.max))) },
    },
    audioMode: {
      enabled: bool(am.enabled, d.audioMode.enabled),
      formats: formats.length ? formats : [...d.audioMode.formats],
      maximumDurationSeconds: int(am.maximumDurationSeconds, d.audioMode.maximumDurationSeconds, LIP_SYNC_BOUNDS.audioSeconds.min, LIP_SYNC_BOUNDS.audioSeconds.max),
      maximumUploadBytes: int(am.maximumUploadBytes, d.audioMode.maximumUploadBytes, LIP_SYNC_BOUNDS.uploadBytes.min, LIP_SYNC_BOUNDS.uploadBytes.max),
    },
    video: {
      minimumDurationSeconds: minVideo,
      maximumDurationSeconds: Math.max(minVideo, int(video.maximumDurationSeconds, d.video.maximumDurationSeconds, LIP_SYNC_BOUNDS.videoSeconds.min, LIP_SYNC_BOUNDS.videoSeconds.max)),
      maximumUploadBytes: int(video.maximumUploadBytes, d.video.maximumUploadBytes, LIP_SYNC_BOUNDS.uploadBytes.min, LIP_SYNC_BOUNDS.uploadBytes.max),
      maximumPixels: int(video.maximumPixels, d.video.maximumPixels, LIP_SYNC_BOUNDS.pixels.min, LIP_SYNC_BOUNDS.pixels.max),
    },
    tts: {
      // 🔴 LOCKED: the voice provider is ElevenLabs whatever a patch says (the fal.ai brief §17)
      provider: "elevenlabs",
      model: typeof tts.model === "string" && /^elevenlabs\/[A-Za-z0-9_.-]{1,80}$/.test(tts.model.trim()) ? tts.model.trim() : d.tts.model,
      perRequestCents: int(tts.perRequestCents, d.tts.perRequestCents, LIP_SYNC_BOUNDS.cents.min, LIP_SYNC_BOUNDS.cents.max),
      perCharacterCents: num(tts.perCharacterCents, d.tts.perCharacterCents, LIP_SYNC_BOUNDS.cents.min, LIP_SYNC_BOUNDS.cents.max),
      providerCostPerCharacterUsdCents: num(tts.providerCostPerCharacterUsdCents, d.tts.providerCostPerCharacterUsdCents, 0, 1000),
    },
    voiceIds: ids(raw.voiceIds, d.voiceIds),
    languageCodes: ids(raw.languageCodes, d.languageCodes),
    expression: {
      enabled: bool(ex.enabled, d.expression.enabled),
      default: ex.default === "natural" || ex.default === "expressive" ? ex.default : "balanced",
      temperature: {
        natural: num(temp.natural, d.expression.temperature.natural, 0, 1),
        balanced: num(temp.balanced, d.expression.temperature.balanced, 0, 1),
        expressive: num(temp.expressive, d.expression.temperature.expressive, 0, 1),
      },
    },
    activeSpeaker: { enabled: bool(as.enabled, d.activeSpeaker.enabled), default: bool(as.default, d.activeSpeaker.default) },
    duration: {
      policy: (LIP_SYNC_DURATION_POLICIES as readonly string[]).includes(String(du.policy)) ? (du.policy as LipSyncDurationPolicy) : d.duration.policy,
      significantMismatchFraction: num(du.significantMismatchFraction, d.duration.significantMismatchFraction, 0, 1),
      providerSyncMode: du.providerSyncMode === "loop" || du.providerSyncMode === "bounce" ? du.providerSyncMode : "silence",
    },
    basePriceCents: int(raw.basePriceCents, d.basePriceCents, LIP_SYNC_BOUNDS.cents.min, LIP_SYNC_BOUNDS.cents.max),
    minimumChargeCents: int(raw.minimumChargeCents, d.minimumChargeCents, LIP_SYNC_BOUNDS.cents.min, LIP_SYNC_BOUNDS.cents.max),
    pricingVersion: int(raw.pricingVersion, d.pricingVersion, 1, 1_000_000_000),
    pricingUpdatedAt: typeof raw.pricingUpdatedAt === "string" ? raw.pricingUpdatedAt : null,
    version: int(raw.version, d.version, 1, 1_000_000_000),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
  };
}

/** The price-bearing fields: a change bumps `pricingVersion`, stamped on every quote. */
export function lipSyncPricingFingerprint(c: LipSyncProConfig): string {
  return stable({
    models: (["replicate", "fal"] as const).map((v) => [v, c.models[v].perSecondCents, c.models[v].creditMultiplier]),
    tts: [c.tts.perRequestCents, c.tts.perCharacterCents],
    base: c.basePriceCents,
    minimum: c.minimumChargeCents,
  });
}

/** Key order never counts as a change (the normaliser may rebuild an object in another order). */
const stable = (v: unknown): string => JSON.stringify(v, (_k, val) => (val && typeof val === "object" && !Array.isArray(val) ? Object.fromEntries(Object.keys(val as Record<string, unknown>).sort().map((k) => [k, (val as Record<string, unknown>)[k]])) : val));

export function lipSyncFingerprint(c: LipSyncProConfig): string {
  return stable({ enabled: c.enabled, provider: c.provider, models: (["replicate", "fal"] as const).map((v) => [v, c.models[v].model, c.models[v].enabled]), textMode: c.textMode, audioMode: c.audioMode, video: c.video, tts: c.tts, expression: c.expression, activeSpeaker: c.activeSpeaker, duration: c.duration });
}

export function versionLipSyncConfig(previous: LipSyncProConfig, next: LipSyncProConfig, now: Date = new Date()): LipSyncProConfig {
  const priced = lipSyncPricingFingerprint(previous) !== lipSyncPricingFingerprint(next);
  const changed = priced || lipSyncFingerprint(previous) !== lipSyncFingerprint(next);
  return {
    ...next,
    pricingVersion: priced ? previous.pricingVersion + 1 : previous.pricingVersion,
    pricingUpdatedAt: priced ? now.toISOString() : previous.pricingUpdatedAt,
    version: changed ? previous.version + 1 : previous.version,
    updatedAt: changed ? now.toISOString() : previous.updatedAt,
  };
}

/* ───────────────────────────── capabilities ──────────────────────────────── */

/**
 * §12: what a model can take. Declared by each adapter from its live schema;
 * the public config carries the ACTIVE model's flags so the interface shows
 * only what will be honoured. Never assumed from another model.
 */
export interface LipSyncCapabilities {
  supports_text: boolean;
  supports_audio: boolean;
  supports_voice_selection: boolean;
  supports_language: boolean;
  supports_speed: boolean;
  supports_active_speaker: boolean;
  supports_temperature: boolean;
  supports_duration_control: boolean;
  /** The model's own input window, when it documents one (Kling: 2–10 s). */
  video: { minDurationMs: number | null; maxDurationMs: number | null; minEdgePx: number | null; maxEdgePx: number | null; maxBytes: number | null };
  audio: { maxBytes: number | null; containers: readonly string[] };
}

/* ───────────────────────────── the public view ───────────────────────────── */

export interface LipSyncPublicConfig {
  enabled: boolean;
  currency: string;
  symbol: string;
  textMode: { enabled: boolean; minimumCharacters: number; maximumCharacters: number; speed: { min: number; max: number; default: number } };
  audioMode: { enabled: boolean; formats: readonly { id: string; label: string; mimeTypes: readonly string[]; extensions: readonly string[] }[]; maximumDurationSeconds: number; maximumUploadBytes: number };
  video: { maximumDurationSeconds: number; minimumDurationSeconds: number; maximumUploadBytes: number; maximumPixels: number };
  /** The ACTIVE model's capability flags — what the interface may offer. */
  capabilities: LipSyncCapabilities;
  /** Whether typed text is spoken by the model itself ("native") or by the voice provider first ("tts"). */
  speechPath: "native" | "tts";
  expression: { enabled: boolean; default: LipSyncExpression; options: readonly LipSyncExpression[] };
  activeSpeaker: { enabled: boolean; default: boolean };
  duration: { policy: LipSyncDurationPolicy; significantMismatchFraction: number };
  /** The sentence beside the price — server-formatted, never a rate to compute with. */
  priceLine: string | null;
  pricingVersion: number;
}

/** "from $0.25/sec" — one sentence, like the Character Replace scope line. */
export function lipSyncPriceLine(perSecondCents: number, baseCents: number, symbol: string): string | null {
  if (perSecondCents <= 0 && baseCents <= 0) return null;
  const major = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));
  const parts = [] as string[];
  if (perSecondCents > 0) parts.push(`${symbol}${major(perSecondCents)}/sec`);
  if (baseCents > 0) parts.push(`${symbol}${major(baseCents)} per video`);
  return `from ${parts.join(" + ")}`;
}
