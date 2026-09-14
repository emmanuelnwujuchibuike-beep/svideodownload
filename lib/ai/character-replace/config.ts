/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CHARACTER REPLACE — the configuration boundary
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-13 (Part 1, §15): "Do NOT hard-code these values throughout
 * components. Create a clean configuration boundary."
 *
 * This is that boundary. Everything an operator will one day tune — whether
 * the tool is on, the qualities it offers, the price per second and the
 * multipliers, the lip-sync tiers, the languages, the ceilings — is ONE typed
 * object with ONE normaliser, stored under a single key in the operator
 * settings row (`landing.frenzAiCharacterReplace`, see lib/landing/settings.ts)
 * and served to the browser, already normalised, by
 * `GET /api/ai/character-replace/config`.
 *
 * ── Pure ─────────────────────────────────────────────────────────────────────
 *
 * No `server-only`, no env reads, no React. The client imports the TYPES and
 * the display helpers; the server imports the normaliser. A value the client
 * holds is always the server's answer — the browser never computes what is
 * allowed, only renders it.
 *
 * ── 🔴 THE RATES HERE ARE INPUTS, AND ONLY THE SERVER TURNS THEM INTO A PRICE ─
 *
 * Part 3 added the engine (pricing.ts) and the quote route. The rates never
 * leave the server — `publicCharacterReplaceConfig` strips them — so a
 * browser can render what is offered and the ceilings, and can only ever
 * SHOW a price the server computed. A change to any price-bearing field
 * bumps `pricingVersion` (settings writer) and the old configuration is kept
 * in `pricingHistory`; every charge snapshot names the version it was made
 * under.
 */

/* ───────────────────────────── qualities ─────────────────────────────────── */

export type CharacterReplaceQualityId = "480p" | "720p" | "1080p";

export interface CharacterReplaceQuality {
  id: CharacterReplaceQualityId;
  label: string;
  /** "Fast" / "Balanced" / "Best" — a hint, not a claim about the model. */
  hint: string;
  /** Longest edge in pixels the output is rendered at. */
  longEdge: number;
  /** Price multiplier relative to the base rate. 1 = the base. */
  multiplier: number;
  /**
   * A per-second rate of this tier's own, in minor units. When set it REPLACES
   * `base × multiplier` — Part 3 §9 asks for both models, and this is the
   * switch between them: null means "use the multiplier".
   */
  perSecondCents: number | null;
  enabled: boolean;
}

/** Every quality the interface knows how to draw, lowest first. */
export const CHARACTER_REPLACE_QUALITY_IDS: readonly CharacterReplaceQualityId[] = ["480p", "720p", "1080p"] as const;

export function isCharacterReplaceQualityId(value: unknown): value is CharacterReplaceQualityId {
  return typeof value === "string" && (CHARACTER_REPLACE_QUALITY_IDS as readonly string[]).includes(value);
}

/* ───────────────────────────── voice / lip sync ──────────────────────────── */

export type CharacterReplaceAudioMode = "original" | "new_voice";

export type CharacterReplaceLipSyncTier = "standard" | "studio";

export interface CharacterReplaceLipSyncOption {
  id: CharacterReplaceLipSyncTier;
  label: string;
  blurb: string;
  /** True for the premium tier — drawn with the plan seal, never with "PRO" text. */
  premium: boolean;
  /** Added per second of video when this tier is chosen. Input to the engine. */
  perSecondCents: number;
  enabled: boolean;
}

export interface CharacterReplaceLanguage {
  /** BCP-47 primary subtag, lower-case. */
  code: string;
  label: string;
  /** The language's own name, shown small under the label. */
  native: string;
}

export interface CharacterReplaceVoice {
  id: string;
  label: string;
  /** "Warm" / "Bright" — a description, not a person. */
  blurb: string;
  /** Languages this voice can speak; empty means every configured language. */
  languages: readonly string[];
}

/* ───────────────────────────── the object ────────────────────────────────── */

/**
 * The operator-tunable configuration, in full. This is what the settings row
 * stores (nested under one key) and what the normaliser below guarantees.
 */
export interface CharacterReplaceConfig {
  /** The whole tool, on or off. Off = the entry card says so and the workspace refuses. */
  enabled: boolean;
  /** The base rate, in minor units of the AI currency, per second of video. */
  pricePerSecondCents: number;
  /** A flat amount added to every job. Zero is allowed. */
  basePriceCents: number;
  /** The least any job costs, whatever the maths says. */
  minimumChargeCents: number;
  /**
   * The longest video the tool accepts, in seconds. Clamped to the registry's
   * hard ceiling (lib/ai/jobs.ts `maxDurationSeconds`) — an operator can make
   * the tool stricter than the platform, never looser.
   */
  maximumDurationSeconds: number;
  /** The most bytes a source video may be. Clamped to the platform ceiling. */
  maximumUploadBytes: number;
  /** The most pixels (width × height) a source video may carry. */
  maximumPixels: number;
  qualities: readonly CharacterReplaceQuality[];
  /** Whether "New voice" is offered at all. Off hides the whole section. */
  lipSyncEnabled: boolean;
  lipSync: readonly CharacterReplaceLipSyncOption[];
  /**
   * The languages the interface OFFERS. §9: "Do NOT claim that all of these
   * languages are supported by the final AI provider yet." This list is what
   * the operator has switched on; the provider adapter in a later part will
   * intersect it with what the configured TTS actually speaks.
   */
  languages: readonly CharacterReplaceLanguage[];
  voices: readonly CharacterReplaceVoice[];
  /**
   * Trim rules: the shortest clip the tool will make, and whether trimming is
   * offered. Trimming is how a member REDUCES their price (§7), so it is on by
   * default; an operator can switch it off if the model ever needs whole clips.
   */
  trim: {
    enabled: boolean;
    minimumSeconds: number;
  };
  /**
   * ── PRICING VERSION (Part 3, §21) ─────────────────────────────────────────
   * Incremented by the settings writer whenever a price-bearing field changes
   * (lib/landing/settings.ts). Every quote and every charge snapshot carries
   * the version it was made under, and `pricingHistory` keeps the last few
   * superseded configurations, so a change tomorrow never rewrites what was
   * charged today.
   */
  pricingVersion: number;
  pricingUpdatedAt: string | null;
  pricingHistory: readonly { version: number; replacedAt: string; config: Record<string, unknown> }[];
  /** The "New voice" option (Part 3, §11): offered or not, and its surcharge. */
  voice: {
    newVoiceEnabled: boolean;
    /** Added per second of video when a new voice is generated. Zero is allowed. */
    surchargePerSecondCents: number;
  };
  /** The recharge experience (Part 3, §3/§23): bounds and the packages offered. */
  recharge: {
    minCents: number;
    maxCents: number;
    packages: readonly { amountCents: number; enabled: boolean; order: number }[];
  };
}

/* ───────────────────────────── defaults ──────────────────────────────────── */

/** 100 MB — the platform's video ceiling (lib/ai/media.ts). Repeated as a number, not imported, so this module has no imports at all. */
const PLATFORM_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
/** 120 s — the registry's hard ceiling for this tool (lib/ai/jobs.ts). */
const PLATFORM_MAX_DURATION_SECONDS = 120;
/** 3840 × 2160. */
const PLATFORM_MAX_PIXELS = 3840 * 2160;

export const CHARACTER_REPLACE_DEFAULT_LANGUAGES: readonly CharacterReplaceLanguage[] = [
  { code: "en", label: "English", native: "English" },
  { code: "fr", label: "French", native: "Français" },
  { code: "es", label: "Spanish", native: "Español" },
  { code: "pt", label: "Portuguese", native: "Português" },
  { code: "de", label: "German", native: "Deutsch" },
  { code: "it", label: "Italian", native: "Italiano" },
  { code: "ar", label: "Arabic", native: "العربية" },
  { code: "hi", label: "Hindi", native: "हिन्दी" },
  { code: "zh", label: "Chinese", native: "中文" },
  { code: "ja", label: "Japanese", native: "日本語" },
  { code: "ko", label: "Korean", native: "한국어" },
  { code: "yo", label: "Yoruba", native: "Yorùbá" },
  { code: "ig", label: "Igbo", native: "Igbo" },
  { code: "ha", label: "Hausa", native: "Hausa" },
];

/**
 * Placeholder voices, described by character rather than named after anyone.
 * Replaced by the TTS provider's own catalogue in a later part; the ids are
 * stable so a saved project keeps its choice.
 */
export const CHARACTER_REPLACE_DEFAULT_VOICES: readonly CharacterReplaceVoice[] = [
  { id: "warm", label: "Warm", blurb: "Low, calm and close.", languages: [] },
  { id: "bright", label: "Bright", blurb: "Clear, light and quick.", languages: [] },
  { id: "deep", label: "Deep", blurb: "Full and steady.", languages: [] },
  { id: "soft", label: "Soft", blurb: "Gentle, with air in it.", languages: [] },
];

export const CHARACTER_REPLACE_DEFAULTS: CharacterReplaceConfig = {
  // ON: switching a tool off is a decision an operator makes, not a state a
  // fresh install falls into — the same rule the free tier follows.
  enabled: true,
  /*
    Placeholders in the AI currency's minor units. They are NOT prices anyone
    is quoted — the engine that would turn them into one is Part 2+ — and the
    admin form is where the real numbers will be typed. They exist so the
    schema is complete and the normaliser has a floor to fall back to.
  */
  pricePerSecondCents: 25,
  basePriceCents: 0,
  minimumChargeCents: 100,
  maximumDurationSeconds: 60,
  maximumUploadBytes: PLATFORM_MAX_UPLOAD_BYTES,
  maximumPixels: PLATFORM_MAX_PIXELS,
  /*
    🔴 1080p SHIPS DISABLED. The provider the owner named for Part 4 (Wan 2.2
    Animate Replace on Replicate) documents 480 and 720 processing resolutions
    and nothing above. Part 4's brief: "Do NOT silently downgrade 1080p to
    720p… Prefer configuration-driven supported qualities." So the tier exists
    in the schema, the renderer knows how to draw it, and the operator can
    switch it on the day a provider supports it — until then it is not offered.
  */
  qualities: [
    { id: "480p", label: "480p", hint: "Fast", longEdge: 854, multiplier: 0.6, perSecondCents: null, enabled: true },
    { id: "720p", label: "720p", hint: "Balanced", longEdge: 1280, multiplier: 1, perSecondCents: null, enabled: true },
    { id: "1080p", label: "1080p", hint: "Best", longEdge: 1920, multiplier: 1.6, perSecondCents: null, enabled: false },
  ],
  lipSyncEnabled: true,
  lipSync: [
    {
      id: "standard",
      label: "Standard",
      blurb: "Natural mouth movement matched to the new voice.",
      premium: false,
      perSecondCents: 10,
      enabled: true,
    },
    {
      id: "studio",
      label: "Studio",
      blurb: "Finer detail around the mouth and teeth, for close-ups.",
      premium: true,
      perSecondCents: 25,
      enabled: true,
    },
  ],
  languages: CHARACTER_REPLACE_DEFAULT_LANGUAGES,
  voices: CHARACTER_REPLACE_DEFAULT_VOICES,
  trim: { enabled: true, minimumSeconds: 1 },
  pricingVersion: 1,
  pricingUpdatedAt: null,
  pricingHistory: [],
  // Offered, with no surcharge until the operator sets one — TTS is a later
  // part and its cost is not known yet (§11: "Do not invent a final price").
  voice: { newVoiceEnabled: true, surchargePerSecondCents: 0 },
  /*
    ₦500 … ₦10,000 in kobo — the owner's example ladder (§23), as DEFAULTS an
    operator edits, not as final values. The bounds clamp a custom amount.
  */
  recharge: {
    minCents: 50_000,
    maxCents: 5_000_000,
    packages: [
      { amountCents: 50_000, enabled: true, order: 1 },
      { amountCents: 100_000, enabled: true, order: 2 },
      { amountCents: 250_000, enabled: true, order: 3 },
      { amountCents: 500_000, enabled: true, order: 4 },
      { amountCents: 1_000_000, enabled: true, order: 5 },
    ],
  },
};

/* ───────────────────────────── normaliser ────────────────────────────────── */

function int(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** A short identifier that is safe to echo into markup and a database. */
function slug(value: unknown, fallback: string): string {
  const s = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z0-9_-]{1,40}$/.test(s) ? s : fallback;
}

function text(value: unknown, fallback: string, max = 60): string {
  const s = typeof value === "string" ? value.trim() : "";
  return s ? s.slice(0, max) : fallback;
}

/**
 * Whatever is stored, made into a `CharacterReplaceConfig` the product can act
 * on. Every field is clamped rather than trusted: an admin field is still an
 * input, and several of these become money.
 *
 * 🔴 The QUALITY and LIP-SYNC lists are keyed by id and merged over the
 * defaults, never replaced by them: an operator may switch a tier off, rename
 * it, or change its multiplier, but cannot invent a fourth quality the
 * renderer has no idea how to draw. Unknown ids are dropped. Languages and
 * voices CAN be extended, because they are catalogue rows with no code behind
 * them.
 */
export function normalizeCharacterReplaceConfig(raw: unknown): CharacterReplaceConfig {
  const d = CHARACTER_REPLACE_DEFAULTS;
  if (!isRecord(raw)) return d;

  const qualityOverrides = new Map<string, Record<string, unknown>>();
  if (Array.isArray(raw.qualities)) {
    for (const q of raw.qualities) if (isRecord(q) && isCharacterReplaceQualityId(q.id)) qualityOverrides.set(q.id, q);
  }
  const qualities = d.qualities.map((base) => {
    const o = qualityOverrides.get(base.id);
    if (!o) return base;
    const rate = o.perSecondCents === null ? null : int(o.perSecondCents, -1, 0, 100_000_000);
    return {
      ...base,
      label: text(o.label, base.label, 12),
      hint: text(o.hint, base.hint, 24),
      multiplier: num(o.multiplier, base.multiplier, 0.05, 20),
      // A missing or malformed rate falls back to the multiplier model, never to zero.
      perSecondCents: rate === null || rate < 0 ? (o.perSecondCents === undefined ? base.perSecondCents : null) : rate,
      enabled: bool(o.enabled, base.enabled),
    };
  });
  // At least one quality stays on, or the settings step has nothing to choose.
  if (!qualities.some((q) => q.enabled)) {
    const balanced = qualities.find((q) => q.id === "720p") ?? qualities[0]!;
    balanced.enabled = true;
  }

  const lipOverrides = new Map<string, Record<string, unknown>>();
  if (Array.isArray(raw.lipSync)) {
    for (const l of raw.lipSync) if (isRecord(l) && (l.id === "standard" || l.id === "studio")) lipOverrides.set(l.id, l);
  }
  const lipSync = d.lipSync.map((base) => {
    const o = lipOverrides.get(base.id);
    if (!o) return base;
    return {
      ...base,
      label: text(o.label, base.label, 20),
      blurb: text(o.blurb, base.blurb, 120),
      perSecondCents: int(o.perSecondCents, base.perSecondCents, 0, 1_000_000),
      enabled: bool(o.enabled, base.enabled),
    };
  });

  const languages: CharacterReplaceLanguage[] = Array.isArray(raw.languages)
    ? raw.languages
        .filter(isRecord)
        .map((l) => ({
          code: slug(l.code, ""),
          label: text(l.label, "", 40),
          native: text(l.native, "", 40),
        }))
        .filter((l) => l.code && l.label)
        .map((l) => ({ ...l, native: l.native || l.label }))
        .slice(0, 60)
    : [...d.languages];

  const voices: CharacterReplaceVoice[] = Array.isArray(raw.voices)
    ? raw.voices
        .filter(isRecord)
        .map((v) => ({
          id: slug(v.id, ""),
          label: text(v.label, "", 40),
          blurb: text(v.blurb, "", 80),
          languages: Array.isArray(v.languages) ? v.languages.map((c) => slug(c, "")).filter(Boolean) : [],
        }))
        .filter((v) => v.id && v.label)
        .slice(0, 40)
    : [...d.voices];

  const trimRaw = isRecord(raw.trim) ? raw.trim : {};
  const voiceRaw = isRecord(raw.voice) ? raw.voice : {};
  const rechargeRaw = isRecord(raw.recharge) ? raw.recharge : {};
  const minCents = int(rechargeRaw.minCents, d.recharge.minCents, 100, 1_000_000_000);
  const maxCents = Math.max(minCents, int(rechargeRaw.maxCents, d.recharge.maxCents, 100, 10_000_000_000));
  const packages = Array.isArray(rechargeRaw.packages)
    ? rechargeRaw.packages
        .filter(isRecord)
        .map((pkg, i) => ({
          amountCents: int(pkg.amountCents, 0, 0, 10_000_000_000),
          enabled: bool(pkg.enabled, true),
          order: int(pkg.order, i + 1, 0, 1000),
        }))
        .filter((pkg) => pkg.amountCents > 0)
        .sort((a, b) => a.order - b.order)
        .slice(0, 12)
    : [...d.recharge.packages];
  const history = Array.isArray(raw.pricingHistory)
    ? raw.pricingHistory
        .filter(isRecord)
        .map((h) => ({
          version: int(h.version, 0, 0, 1_000_000),
          replacedAt: text(h.replacedAt, "", 40),
          config: isRecord(h.config) ? h.config : {},
        }))
        .filter((h) => h.version > 0 && h.replacedAt)
        .slice(-20)
    : [];

  return {
    enabled: bool(raw.enabled, d.enabled),
    pricePerSecondCents: int(raw.pricePerSecondCents, d.pricePerSecondCents, 0, 10_000_000),
    basePriceCents: int(raw.basePriceCents, d.basePriceCents, 0, 100_000_000),
    minimumChargeCents: int(raw.minimumChargeCents, d.minimumChargeCents, 0, 100_000_000),
    maximumDurationSeconds: int(raw.maximumDurationSeconds, d.maximumDurationSeconds, 1, PLATFORM_MAX_DURATION_SECONDS),
    maximumUploadBytes: int(raw.maximumUploadBytes, d.maximumUploadBytes, 1024 * 1024, PLATFORM_MAX_UPLOAD_BYTES),
    maximumPixels: int(raw.maximumPixels, d.maximumPixels, 640 * 360, PLATFORM_MAX_PIXELS),
    qualities,
    lipSyncEnabled: bool(raw.lipSyncEnabled, d.lipSyncEnabled),
    lipSync,
    languages: languages.length ? languages : [...d.languages],
    voices: voices.length ? voices : [...d.voices],
    trim: {
      enabled: bool(trimRaw.enabled, d.trim.enabled),
      minimumSeconds: num(trimRaw.minimumSeconds, d.trim.minimumSeconds, 0.5, 30),
    },
    pricingVersion: int(raw.pricingVersion, d.pricingVersion, 1, 1_000_000),
    pricingUpdatedAt: typeof raw.pricingUpdatedAt === "string" ? raw.pricingUpdatedAt.slice(0, 40) : null,
    pricingHistory: history,
    voice: {
      newVoiceEnabled: bool(voiceRaw.newVoiceEnabled, d.voice.newVoiceEnabled),
      surchargePerSecondCents: int(voiceRaw.surchargePerSecondCents, d.voice.surchargePerSecondCents, 0, 100_000_000),
    },
    recharge: { minCents, maxCents, packages: packages.length ? packages : [...d.recharge.packages] },
  };
}

/**
 * The fields a quote depends on. Two configs that agree on all of these price
 * every job identically; a change to any of them is a new pricing version.
 * Used by the settings writer to decide when to bump.
 */
export function pricingFingerprint(config: CharacterReplaceConfig): string {
  return JSON.stringify({
    base: config.basePriceCents,
    perSecond: config.pricePerSecondCents,
    minimum: config.minimumChargeCents,
    qualities: config.qualities.map((q) => [q.id, q.multiplier, q.perSecondCents, q.enabled]),
    lipSync: config.lipSync.map((l) => [l.id, l.perSecondCents, l.enabled]),
    lipSyncEnabled: config.lipSyncEnabled,
    voice: [config.voice.newVoiceEnabled, config.voice.surchargePerSecondCents],
  });
}

/* ───────────────────────────── what the browser gets ─────────────────────── */

/**
 * The configuration as the interface receives it.
 *
 * The operator's RATES are deliberately absent. A browser holding
 * `pricePerSecondCents` would be a browser that can compute a price, and §10
 * is explicit that it must not — the only price a member ever sees is the
 * server's quote. What the interface needs is what to OFFER (qualities, tiers,
 * languages, voices), the CEILINGS to validate against before an upload, and
 * the currency to print the eventual quote in.
 */
export interface CharacterReplacePublicConfig {
  enabled: boolean;
  currency: string;
  symbol: string;
  maximumDurationSeconds: number;
  maximumUploadBytes: number;
  maximumPixels: number;
  qualities: readonly Pick<CharacterReplaceQuality, "id" | "label" | "hint" | "longEdge">[];
  /** The default the settings step opens on: the balanced tier when it is on. */
  defaultQuality: CharacterReplaceQualityId;
  lipSyncEnabled: boolean;
  lipSync: readonly Pick<CharacterReplaceLipSyncOption, "id" | "label" | "blurb" | "premium">[];
  languages: readonly CharacterReplaceLanguage[];
  voices: readonly CharacterReplaceVoice[];
  trim: { enabled: boolean; minimumSeconds: number };
  /** Whether "New voice" may be chosen. The surcharge itself stays server-side. */
  newVoiceEnabled: boolean;
  /** The recharge ladder and bounds, in minor units. */
  recharge: { minCents: number; maxCents: number; packages: readonly number[] };
  /** Printed on the summary so a member can see which price list quoted them. */
  pricingVersion: number;
  /**
   * Whether the pricing engine exists on this deployment. False through
   * Part 2 (the interface drew the PENDING state for every total); true from
   * Part 3, when `POST /api/ai/character-replace/quote` answers.
   */
  pricingAvailable: boolean;
}

export function publicCharacterReplaceConfig(
  config: CharacterReplaceConfig,
  currency: { code: string; symbol: string },
  pricingAvailable: boolean,
): CharacterReplacePublicConfig {
  const on = config.qualities.filter((q) => q.enabled);
  const balanced = on.find((q) => q.id === "720p") ?? on[0]!;
  return {
    enabled: config.enabled,
    currency: currency.code,
    symbol: currency.symbol,
    maximumDurationSeconds: config.maximumDurationSeconds,
    maximumUploadBytes: config.maximumUploadBytes,
    maximumPixels: config.maximumPixels,
    qualities: on.map(({ id, label, hint, longEdge }) => ({ id, label, hint, longEdge })),
    defaultQuality: balanced.id,
    lipSyncEnabled: config.lipSyncEnabled && config.lipSync.some((l) => l.enabled),
    lipSync: config.lipSync.filter((l) => l.enabled).map(({ id, label, blurb, premium }) => ({ id, label, blurb, premium })),
    languages: config.languages,
    voices: config.voices,
    trim: config.trim,
    newVoiceEnabled: config.voice.newVoiceEnabled,
    recharge: {
      minCents: config.recharge.minCents,
      maxCents: config.recharge.maxCents,
      packages: config.recharge.packages.filter((p) => p.enabled).map((p) => p.amountCents),
    },
    pricingVersion: config.pricingVersion,
    pricingAvailable,
  };
}

/**
 * ── CHARACTER REPLACE PRICING VERSIONS (Part 3, §21) ────────────────────────
 *
 * When a save changes any price-bearing field, the version increments, the
 * moment is stamped, and the superseded price fields are appended to the
 * history (the last twenty). A save that touches only copy, languages or
 * ceilings leaves the version alone. Every quote and every charge snapshot
 * names the version it was made under, so nothing historical is ever
 * recomputed with today's numbers.
 *
 * 🔴 The version and the history are the SERVER's to write: a panel that
 * posted `pricingVersion` is ignored here, because the merged draft is
 * re-stamped from `current` before the comparison.
 */
export function versionCharacterReplacePricing(current: CharacterReplaceConfig, next: CharacterReplaceConfig): CharacterReplaceConfig {
  const stamped: CharacterReplaceConfig = {
    ...next,
    pricingVersion: current.pricingVersion,
    pricingUpdatedAt: current.pricingUpdatedAt,
    pricingHistory: current.pricingHistory,
  };
  if (pricingFingerprint(current) === pricingFingerprint(stamped)) return stamped;
  const now = new Date().toISOString();
  const superseded = {
    version: current.pricingVersion,
    replacedAt: now,
    config: {
      basePriceCents: current.basePriceCents,
      pricePerSecondCents: current.pricePerSecondCents,
      minimumChargeCents: current.minimumChargeCents,
      qualities: current.qualities.map((q) => ({ id: q.id, multiplier: q.multiplier, perSecondCents: q.perSecondCents, enabled: q.enabled })),
      lipSyncEnabled: current.lipSyncEnabled,
      lipSync: current.lipSync.map((l) => ({ id: l.id, perSecondCents: l.perSecondCents, enabled: l.enabled })),
      voice: current.voice,
    },
  };
  return {
    ...stamped,
    pricingVersion: current.pricingVersion + 1,
    pricingUpdatedAt: now,
    pricingHistory: [...current.pricingHistory, superseded].slice(-20),
  };
}
