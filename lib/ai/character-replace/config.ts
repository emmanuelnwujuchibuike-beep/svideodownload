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

import {
  FACE_ONLY_TIER_MAP,
  REPLACEMENT_MODE_COPY,
  SKIN_FACE_TIER_MAP,
  isReplacementTierId,
  type ReplacementMode,
  type ReplacementTierId,
} from "@/lib/ai/character-replace/modes";
import { ttsSupportedLanguagesFor } from "@/lib/ai/voice/tts-languages";

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
  /**
   * Part 6 §8/§26: which lip-sync model runs this tier. The provider is
   * Replicate for both today; the model name is the operator's to change
   * without a deploy (the version pin lives with the adapter, lib/ai/voice/
   * lipsync-provider.ts). Never shown to a member.
   */
  provider: "replicate";
  model: string;
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
  /**
   * The configured TTS provider's own id for this voice (Part 6 §5). Empty
   * means "the provider's default voice". Members see `label`, never this.
   */
  providerVoiceId: string;
}

/* ───────────────────────────── replacement modes (Part 6) ────────────────── */

/** One quality tier of a replacement mode: its own per-second rate, on or off. */
export interface ReplacementTier {
  id: ReplacementTierId;
  label: string;
  hint: string;
  /** Per second of video, in minor units of the AI currency. The customer rate. */
  perSecondCents: number;
  enabled: boolean;
}

/**
 * The operator-tunable half of a replacement mode (Face Only brief §6,
 * Skin + Face brief §9). The provider mapping of each tier is code
 * (lib/ai/character-replace/modes.ts); what is tunable is whether the mode
 * is offered, what each tier costs the member, the ceilings, and the
 * operator's own estimate of the provider's cost — the last for the
 * margin the admin sees, never the member (§7).
 */
export interface ReplacementModeConfig {
  enabled: boolean;
  tiers: readonly ReplacementTier[];
  maximumDurationSeconds: number;
  maximumUploadBytes: number;
  maximumPixels: number;
  /** How many reference images a member may attach (1 for Face Only; up to 3 for Skin + Face). */
  maximumReferenceImages: number;
  /**
   * The operator's estimate of what the provider bills per second of output,
   * in US cents. Admin-only: recorded on the job as `provider_cost_estimate`
   * and compared with the customer charge in the monitor. Zero = unknown.
   */
  providerCostPerSecondUsdCents: number;
  provider: { id: "replicate"; model: string };
}

/** The audio section (Part 6 §2–§4, §26): replacement audio, and how a mismatch in length is handled. */
export interface CharacterReplaceAudioConfig {
  /** Whether a member may upload their own replacement audio at all. */
  replacementEnabled: boolean;
  maximumDurationSeconds: number;
  maximumUploadBytes: number;
  /**
   * Audio SHORTER than the video: `silence` pads the end (the character
   * stops speaking); `reject` refuses the job before it is charged.
   */
  shorterAudio: "silence" | "reject";
  /**
   * The least of the video the audio must cover, 0–1. Below it the job is
   * refused with "your audio is much shorter than the video" whatever
   * `shorterAudio` says. 0 disables the check.
   */
  minimumCoverageFraction: number;
  /** The lip-sync provider's behaviour for a residual mismatch after our own trim/pad. */
  syncMode: "silence" | "loop" | "bounce";
}

/** The text-to-speech section (Part 6 §5, §26). */
export interface CharacterReplaceTtsConfig {
  enabled: boolean;
  provider: "replicate";
  /** The model the adapter runs. Its version pin lives with the adapter. */
  model: string;
  /** Charged once per generated voice. Zero allowed. */
  perRequestCents: number;
  /** Charged per character of dialogue. Zero allowed. */
  perCharacterCents: number;
  minimumCharacters: number;
  maximumCharacters: number;
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
  pricingHistory: readonly { version: number; replacedAt: string; config: Record<string, unknown>; changedBy: string | null; reason: string | null }[];
  /**
   * The provider's `go_fast` switch (Part 4, §10): "Expose go_fast as an
   * internal provider setting rather than a confusing customer-facing
   * option… Admin configuration may later control this." Never shown to a
   * member; never priced. Off by default — the model's own default — until
   * the owner has compared the two on real footage.
   */
  providerGoFast: boolean;
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
  /**
   * ── PART 6: THE TWO NEW REPLACEMENT MODES ──────────────────────────────
   * Full Character is the top-level configuration above (qualities, base
   * rate, go_fast). Face Only and Skin + Face each carry their own tiers,
   * rates and ceilings here. `modeConfig()` presents all three uniformly.
   */
  modes: {
    face_only: ReplacementModeConfig;
    skin_face: ReplacementModeConfig;
  };
  audio: CharacterReplaceAudioConfig;
  tts: CharacterReplaceTtsConfig;
  /** The longest video a lip-sync run accepts. Clamped to the tool's ceiling. */
  lipSyncMaximumDurationSeconds: number;
  /**
   * ── PART 7 §21: RETENTION, CONFIGURATION-DRIVEN ────────────────────────
   * A finished video is kept `resultHours` (the registry's 72 by default);
   * one the member SAVED is kept `savedResultDays` from the save. Sources
   * and intermediates go with the row's expiry (the sweep removes the whole
   * job folder). Temporary provider files are the provider's own hour.
   */
  retention: {
    resultHours: number;
    savedResultDays: number;
  };
  /**
   * ── PART 8 §2, §4, §8: THE KILL SWITCHES AND THE LIMITS ──────────────────
   * `enabled` above is the feature: off = nobody sees Character Replace as
   * available. These are finer: `processingEnabled` off refuses NEW starts
   * while every running job finishes and every result stays reachable;
   * `maintenanceMode` on shows `maintenanceMessage` on the workspace and
   * refuses creates and starts (results and history stay). The limits are
   * decided inside one database lock at /start (claim_ai_job_start, 0158):
   * 0 = no cap of that kind.
   */
  ops: {
    processingEnabled: boolean;
    maintenanceMode: boolean;
    maintenanceMessage: string;
    /** §7: after `failureThreshold` provider failures inside `windowSeconds`, submits pause for `cooldownSeconds`. */
    circuitBreaker: { enabled: boolean; failureThreshold: number; windowSeconds: number; cooldownSeconds: number };
  };
  limits: {
    /** Per member, counted at /start across acquiring/processing/finalizing. 0 = the plan's own cap only. */
    maxActiveJobsPerUser: number;
    /** Platform-wide, same statuses. 0 = unlimited. */
    maxActiveJobsGlobal: number;
    /** Per member, starts in the last 24 h. 0 = unlimited. */
    maxJobsPerUserPerDay: number;
  };
  /**
   * §25: local minor units per ONE US dollar (₦1,500 = 150,000 kobo), so the
   * admin form can compare a tier's price with the provider's USD cost and
   * warn when the margin is thin. Never shown to a member. 0 = unknown, no
   * warnings.
   */
  localMinorUnitsPerUsd: number;
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
  /*
    Part 6: each row now names the MiniMax system voice behind it (read from
    the model's README on 2026-09-14). The four universal voices speak every
    language the provider hints; the native pairs are offered only for their
    own language, so a Spanish dialogue gets a Spanish-trained voice first.
  */
  { id: "warm", label: "Warm", blurb: "Low, calm and close.", languages: [], providerVoiceId: "English_Wiselady" },
  { id: "bright", label: "Bright", blurb: "Clear, light and quick.", languages: [], providerVoiceId: "English_LovelyGirl" },
  { id: "deep", label: "Deep", blurb: "Full and steady.", languages: [], providerVoiceId: "English_Deep-VoicedGentleman" },
  { id: "soft", label: "Soft", blurb: "Gentle, with air in it.", languages: [], providerVoiceId: "English_Gentle-voiced_man" },
  { id: "es-serene", label: "Serena", blurb: "Calm and clear, Spanish.", languages: ["es"], providerVoiceId: "Spanish_SereneWoman" },
  { id: "es-steady", label: "Mateo", blurb: "Steady and warm, Spanish.", languages: ["es"], providerVoiceId: "Spanish_ReliableMan" },
  { id: "pt-wise", label: "Clara", blurb: "Measured and kind, Portuguese.", languages: ["pt"], providerVoiceId: "Portuguese_Wiselady" },
  { id: "pt-steady", label: "Rafael", blurb: "Steady and warm, Portuguese.", languages: ["pt"], providerVoiceId: "Portuguese_ReliableMan" },
  { id: "fr-anchor", label: "Élise", blurb: "Clear and composed, French.", languages: ["fr"], providerVoiceId: "French_FemaleAnchor" },
  { id: "fr-casual", label: "Louis", blurb: "Relaxed and natural, French.", languages: ["fr"], providerVoiceId: "French_CasualMan" },
  { id: "de-sweet", label: "Lena", blurb: "Light and friendly, German.", languages: ["de"], providerVoiceId: "German_SweetLady" },
  { id: "de-friendly", label: "Jonas", blurb: "Open and friendly, German.", languages: ["de"], providerVoiceId: "German_FriendlyMan" },
  { id: "it-narrator", label: "Marco", blurb: "Storyteller, Italian.", languages: ["it"], providerVoiceId: "Italian_Narrator" },
  { id: "it-brave", label: "Giulia", blurb: "Bright and bold, Italian.", languages: ["it"], providerVoiceId: "Italian_BraveHeroine" },
  { id: "ar-calm", label: "Layla", blurb: "Calm and clear, Arabic.", languages: ["ar"], providerVoiceId: "Arabic_CalmWoman" },
  { id: "ar-friendly", label: "Omar", blurb: "Friendly and easy, Arabic.", languages: ["ar"], providerVoiceId: "Arabic_FriendlyGuy" },
];

/** A replacement tier row, for the two default mode configurations below. */
function tier(id: ReplacementTierId, label: string, hint: string, perSecondCents: number, enabled: boolean): ReplacementTier {
  return { id, label, hint, perSecondCents, enabled };
}

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
  /*
    🔴 50 MB BY DEFAULT, NOT THE PLATFORM'S 100 (2026-09-14). Supabase Storage
    refuses any single object over the project's global limit, which is 50 MB
    unless the operator raises it in the Supabase dashboard — and a 54 MB
    phone video failed its PUT at exactly that wall today. The interface now
    refuses at this figure BEFORE uploading, with the limit in the sentence.
    Raise it here (Admin → Character Replace pricing → Limits) only after
    raising the Storage limit, or uploads fail again with the same symptom.
  */
  maximumUploadBytes: 50 * 1024 * 1024,
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
      // Part 6 §8: the two Sync Labs models on Replicate — Standard runs
      // lipsync-2, Studio runs lipsync-2-pro. Pins in lib/ai/voice/lipsync-provider.ts.
      provider: "replicate",
      model: "sync/lipsync-2",
    },
    {
      id: "studio",
      label: "Studio",
      blurb: "Finer detail around the mouth and teeth, for close-ups.",
      premium: true,
      perSecondCents: 25,
      enabled: true,
      provider: "replicate",
      model: "sync/lipsync-2-pro",
    },
  ],
  languages: CHARACTER_REPLACE_DEFAULT_LANGUAGES,
  voices: CHARACTER_REPLACE_DEFAULT_VOICES,
  trim: { enabled: true, minimumSeconds: 1 },
  pricingVersion: 1,
  pricingUpdatedAt: null,
  pricingHistory: [],
  providerGoFast: false,
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
  /*
    ── PART 6 DEFAULTS ─────────────────────────────────────────────────────
    Placeholder rates in the AI currency's minor units, NOT business prices
    (Face Only brief §3: "Do NOT hard-code these example prices as the final
    business prices"). The admin form is where the real numbers are typed.

    🔴 Face Only ships with High and Ultra DISABLED: xrunda/hello has no
    quality control (modes.ts), and an enabled tier the provider cannot
    honour would be a price for nothing. Skin + Face ships all three on —
    each is a different p-video-replace configuration.
  */
  modes: {
    face_only: {
      enabled: true,
      tiers: [
        tier("standard", "Standard", "The model's one configuration", 15, true),
        tier("high", "High", "Not available for this model", 25, false),
        tier("ultra", "Ultra", "Not available for this model", 40, false),
      ],
      maximumDurationSeconds: 60,
      maximumUploadBytes: 50 * 1024 * 1024,
      maximumPixels: PLATFORM_MAX_PIXELS,
      maximumReferenceImages: 1,
      providerCostPerSecondUsdCents: 0,
      provider: { id: "replicate", model: "xrunda/hello" },
    },
    skin_face: {
      enabled: true,
      tiers: [
        tier("standard", "Standard", "720p · fast", 30, true),
        tier("high", "High", "720p · full quality", 60, true),
        tier("ultra", "Ultra", "1080p · full quality", 90, true),
      ],
      maximumDurationSeconds: 60,
      maximumUploadBytes: 50 * 1024 * 1024,
      maximumPixels: PLATFORM_MAX_PIXELS,
      maximumReferenceImages: 3,
      providerCostPerSecondUsdCents: 0,
      provider: { id: "replicate", model: "prunaai/p-video-replace" },
    },
  },
  audio: {
    replacementEnabled: true,
    maximumDurationSeconds: 120,
    maximumUploadBytes: 25 * 1024 * 1024,
    shorterAudio: "silence",
    minimumCoverageFraction: 0.5,
    syncMode: "silence",
  },
  tts: {
    enabled: true,
    provider: "replicate",
    model: "minimax/speech-02-hd",
    perRequestCents: 0,
    perCharacterCents: 0,
    minimumCharacters: 1,
    maximumCharacters: 1_000,
  },
  lipSyncMaximumDurationSeconds: 60,
  retention: { resultHours: 72, savedResultDays: 30 },
  ops: {
    processingEnabled: true,
    maintenanceMode: false,
    maintenanceMessage: "Character Replace is being looked after right now. Your finished videos are still here — new videos will be back shortly.",
    circuitBreaker: { enabled: true, failureThreshold: 5, windowSeconds: 600, cooldownSeconds: 300 },
  },
  limits: { maxActiveJobsPerUser: 0, maxActiveJobsGlobal: 25, maxJobsPerUserPerDay: 0 },
  localMinorUnitsPerUsd: 0,
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
      provider: "replicate" as const,
      model: modelName(o.model, base.model),
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
          providerVoiceId: providerVoiceId(v.providerVoiceId, d.voices.find((x) => x.id === slug(v.id, ""))?.providerVoiceId ?? ""),
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
          // Part 6 §27: who changed it and why. Absent on entries written before.
          changedBy: typeof h.changedBy === "string" ? h.changedBy.slice(0, 80) : null,
          reason: typeof h.reason === "string" ? h.reason.trim().slice(0, 300) : null,
        }))
        .filter((h) => h.version > 0 && h.replacedAt)
        .slice(-20)
    : [];

  const modesRaw = isRecord(raw.modes) ? raw.modes : {};
  const audioRaw = isRecord(raw.audio) ? raw.audio : {};
  const ttsRaw = isRecord(raw.tts) ? raw.tts : {};
  const opsRaw = isRecord(raw.ops) ? raw.ops : {};
  const breakerRaw = isRecord(opsRaw.circuitBreaker) ? opsRaw.circuitBreaker : {};
  const limitsRaw = isRecord(raw.limits) ? raw.limits : {};

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
    providerGoFast: bool(raw.providerGoFast, d.providerGoFast),
    voice: {
      newVoiceEnabled: bool(voiceRaw.newVoiceEnabled, d.voice.newVoiceEnabled),
      surchargePerSecondCents: int(voiceRaw.surchargePerSecondCents, d.voice.surchargePerSecondCents, 0, 100_000_000),
    },
    recharge: { minCents, maxCents, packages: packages.length ? packages : [...d.recharge.packages] },
    modes: {
      face_only: normalizeModeConfig(modesRaw.face_only, d.modes.face_only, "face_only"),
      skin_face: normalizeModeConfig(modesRaw.skin_face, d.modes.skin_face, "skin_face"),
    },
    audio: {
      replacementEnabled: bool(audioRaw.replacementEnabled, d.audio.replacementEnabled),
      maximumDurationSeconds: int(audioRaw.maximumDurationSeconds, d.audio.maximumDurationSeconds, 1, 30 * 60),
      maximumUploadBytes: int(audioRaw.maximumUploadBytes, d.audio.maximumUploadBytes, 64 * 1024, 100 * 1024 * 1024),
      shorterAudio: audioRaw.shorterAudio === "reject" ? "reject" : "silence",
      minimumCoverageFraction: num(audioRaw.minimumCoverageFraction, d.audio.minimumCoverageFraction, 0, 1),
      syncMode: audioRaw.syncMode === "loop" || audioRaw.syncMode === "bounce" ? audioRaw.syncMode : "silence",
    },
    tts: {
      enabled: bool(ttsRaw.enabled, d.tts.enabled),
      provider: "replicate",
      model: modelName(ttsRaw.model, d.tts.model),
      perRequestCents: int(ttsRaw.perRequestCents, d.tts.perRequestCents, 0, 100_000_000),
      perCharacterCents: int(ttsRaw.perCharacterCents, d.tts.perCharacterCents, 0, 1_000_000),
      minimumCharacters: int(ttsRaw.minimumCharacters, d.tts.minimumCharacters, 1, 10_000),
      maximumCharacters: Math.max(
        int(ttsRaw.minimumCharacters, d.tts.minimumCharacters, 1, 10_000),
        int(ttsRaw.maximumCharacters, d.tts.maximumCharacters, 1, 10_000),
      ),
    },
    lipSyncMaximumDurationSeconds: int(raw.lipSyncMaximumDurationSeconds, d.lipSyncMaximumDurationSeconds, 1, PLATFORM_MAX_DURATION_SECONDS),
    retention: {
      resultHours: int(isRecord(raw.retention) ? raw.retention.resultHours : undefined, d.retention.resultHours, 1, 24 * 30),
      savedResultDays: int(isRecord(raw.retention) ? raw.retention.savedResultDays : undefined, d.retention.savedResultDays, 1, 365),
    },
    ops: {
      processingEnabled: bool(opsRaw.processingEnabled, d.ops.processingEnabled),
      maintenanceMode: bool(opsRaw.maintenanceMode, d.ops.maintenanceMode),
      maintenanceMessage: text(opsRaw.maintenanceMessage, d.ops.maintenanceMessage, 300),
      circuitBreaker: {
        enabled: bool(breakerRaw.enabled, d.ops.circuitBreaker.enabled),
        failureThreshold: int(breakerRaw.failureThreshold, d.ops.circuitBreaker.failureThreshold, 1, 1_000),
        windowSeconds: int(breakerRaw.windowSeconds, d.ops.circuitBreaker.windowSeconds, 30, 86_400),
        cooldownSeconds: int(breakerRaw.cooldownSeconds, d.ops.circuitBreaker.cooldownSeconds, 30, 86_400),
      },
    },
    limits: {
      maxActiveJobsPerUser: int(limitsRaw.maxActiveJobsPerUser, d.limits.maxActiveJobsPerUser, 0, 100),
      maxActiveJobsGlobal: int(limitsRaw.maxActiveJobsGlobal, d.limits.maxActiveJobsGlobal, 0, 10_000),
      maxJobsPerUserPerDay: int(limitsRaw.maxJobsPerUserPerDay, d.limits.maxJobsPerUserPerDay, 0, 10_000),
    },
    localMinorUnitsPerUsd: int(raw.localMinorUnitsPerUsd, d.localMinorUnitsPerUsd, 0, 100_000_000),
  };
}

/** "owner/model" — letters, digits, dots, dashes, one slash. Anything else keeps the default. */
function modelName(value: unknown, fallback: string): string {
  const s = typeof value === "string" ? value.trim() : "";
  return /^[a-z0-9][a-z0-9._-]{0,60}\/[a-z0-9][a-z0-9._-]{0,80}$/i.test(s) ? s : fallback;
}

/** A provider voice id: printable, short. Empty means the provider's default. */
function providerVoiceId(value: unknown, fallback: string): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) return fallback;
  return /^[A-Za-z0-9 ()（）_.,:@-]{1,80}$/.test(s) ? s : fallback;
}

/**
 * One replacement mode's configuration, clamped like everything else. Tiers
 * are keyed by id and merged over the defaults — an operator may re-price or
 * switch a tier, never invent a fourth. 🔴 A tier the provider cannot honour
 * (modes.ts) is forced OFF whatever was saved: there is no honest price for
 * a setting that changes nothing.
 */
function normalizeModeConfig(raw: unknown, base: ReplacementModeConfig, mode: "face_only" | "skin_face"): ReplacementModeConfig {
  const r = isRecord(raw) ? raw : {};
  const overrides = new Map<string, Record<string, unknown>>();
  if (Array.isArray(r.tiers)) for (const t of r.tiers) if (isRecord(t) && isReplacementTierId(t.id)) overrides.set(t.id, t);
  const map = mode === "face_only" ? FACE_ONLY_TIER_MAP : SKIN_FACE_TIER_MAP;
  const tiers = base.tiers.map((b) => {
    const o = overrides.get(b.id);
    const merged = o
      ? { ...b, label: text(o.label, b.label, 12), hint: text(o.hint, b.hint, 40), perSecondCents: int(o.perSecondCents, b.perSecondCents, 0, 100_000_000), enabled: bool(o.enabled, b.enabled) }
      : { ...b };
    if (map[b.id].support !== "supported") merged.enabled = false;
    return merged;
  });
  if (!tiers.some((t) => t.enabled)) {
    const standard = tiers.find((t) => t.id === "standard");
    if (standard && map.standard.support === "supported") standard.enabled = true;
  }
  const providerRaw = isRecord(r.provider) ? r.provider : {};
  return {
    enabled: bool(r.enabled, base.enabled),
    tiers,
    maximumDurationSeconds: int(r.maximumDurationSeconds, base.maximumDurationSeconds, 1, PLATFORM_MAX_DURATION_SECONDS),
    maximumUploadBytes: int(r.maximumUploadBytes, base.maximumUploadBytes, 1024 * 1024, PLATFORM_MAX_UPLOAD_BYTES),
    maximumPixels: int(r.maximumPixels, base.maximumPixels, 640 * 360, PLATFORM_MAX_PIXELS),
    maximumReferenceImages: int(r.maximumReferenceImages, base.maximumReferenceImages, 1, REPLACEMENT_MODE_COPY[mode].maxReferenceImages),
    providerCostPerSecondUsdCents: num(r.providerCostPerSecondUsdCents, base.providerCostPerSecondUsdCents, 0, 100_000),
    provider: { id: "replicate", model: modelName(providerRaw.model, base.provider.model) },
  };
}

/* ───────────────────────────── one view of three modes ───────────────────── */

/** A tier as every mode presents it — Full Character's 480p/720p/1080p included. */
export interface ModeTierView {
  id: string;
  label: string;
  hint: string;
  perSecondCents: number;
  enabled: boolean;
  /** Whether the provider can honour it (false = drawn disabled, refused by the engine). */
  supported: boolean;
  note: string | null;
}

export interface ModeView {
  mode: ReplacementMode;
  enabled: boolean;
  tiers: readonly ModeTierView[];
  maximumDurationSeconds: number;
  maximumUploadBytes: number;
  maximumPixels: number;
  maximumReferenceImages: number;
  providerModel: string;
  providerCostPerSecondUsdCents: number;
}

/**
 * The three modes through one lens, so the engine, the validators, the
 * limits and the admin monitor never branch on "is this the old one".
 * Full Character's tiers are the top-level qualities priced by the base
 * rate × multiplier (or their own rate) — exactly as Part 3 computed them.
 */
export function modeConfig(config: CharacterReplaceConfig, mode: ReplacementMode): ModeView {
  if (mode === "full_character") {
    return {
      mode,
      enabled: config.enabled,
      tiers: config.qualities.map((q) => ({
        id: q.id,
        label: q.label,
        hint: q.hint,
        perSecondCents: q.perSecondCents !== null ? q.perSecondCents : Math.ceil(config.pricePerSecondCents * q.multiplier),
        enabled: q.enabled,
        // Wan documents 480 and 720; 1080p is a tier the operator may switch on the day a provider offers it.
        supported: q.id !== "1080p",
        note: q.id === "1080p" ? "The provider documents 480p and 720p only." : null,
      })),
      maximumDurationSeconds: config.maximumDurationSeconds,
      maximumUploadBytes: config.maximumUploadBytes,
      maximumPixels: config.maximumPixels,
      maximumReferenceImages: 1,
      providerModel: "wan-video/wan-2.2-animate-replace",
      providerCostPerSecondUsdCents: 0,
    };
  }
  const m = config.modes[mode];
  const map = mode === "face_only" ? FACE_ONLY_TIER_MAP : SKIN_FACE_TIER_MAP;
  return {
    mode,
    enabled: config.enabled && m.enabled,
    tiers: m.tiers.map((t) => ({
      id: t.id,
      label: t.label,
      hint: t.hint,
      perSecondCents: t.perSecondCents,
      enabled: t.enabled && map[t.id].support === "supported",
      supported: map[t.id].support === "supported",
      note: map[t.id].note,
    })),
    maximumDurationSeconds: Math.min(m.maximumDurationSeconds, config.maximumDurationSeconds),
    maximumUploadBytes: m.maximumUploadBytes,
    maximumPixels: m.maximumPixels,
    maximumReferenceImages: m.maximumReferenceImages,
    providerModel: m.provider.model,
    providerCostPerSecondUsdCents: m.providerCostPerSecondUsdCents,
  };
}

/** The tier a mode opens on: the balanced one when it is on, else the first that is. */
export function defaultTierFor(view: ModeView): string | null {
  const on = view.tiers.filter((t) => t.enabled);
  if (!on.length) return null;
  return (on.find((t) => t.id === "720p") ?? on.find((t) => t.id === "high") ?? on[0]!).id;
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
    // Part 6: the two new modes' tiers and the TTS prices are price-bearing too.
    modes: (["face_only", "skin_face"] as const).map((m) => [m, config.modes[m].enabled, config.modes[m].tiers.map((t) => [t.id, t.perSecondCents, t.enabled])]),
    tts: [config.tts.enabled, config.tts.perRequestCents, config.tts.perCharacterCents],
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
  /*
    ── PART 6 ───────────────────────────────────────────────────────────────
    The replacement modes as the selector draws them — every tier, with
    `enabled`/`supported` so an unsupported tier is drawn disabled with its
    note rather than hidden (Face Only brief §2 asks for all three chips).
    Rates are absent, as everywhere else in this object.
  */
  modes: readonly CharacterReplacePublicMode[];
  /** The mode the selector opens on. */
  defaultMode: ReplacementMode;
  audio: {
    /** Whether a member may upload replacement audio. */
    uploadEnabled: boolean;
    maximumDurationSeconds: number;
    maximumUploadBytes: number;
    shorterAudio: "silence" | "reject";
    minimumCoverageFraction: number;
  };
  tts: {
    enabled: boolean;
    minimumCharacters: number;
    maximumCharacters: number;
    /** Language codes the CONFIGURED provider speaks, intersected with the operator's catalogue. */
    languages: readonly string[];
  };
  lipSyncMaximumDurationSeconds: number;
  /** Part 7 §21: how long a result is kept, and how long a saved one — printed, never assumed. */
  retention: { resultHours: number; savedResultDays: number };
}

export interface CharacterReplacePublicMode {
  id: ReplacementMode;
  label: string;
  tagline: string;
  explanation: string;
  enabled: boolean;
  tiers: readonly { id: string; label: string; hint: string; enabled: boolean; supported: boolean; note: string | null }[];
  defaultTier: string | null;
  maximumDurationSeconds: number;
  maximumUploadBytes: number;
  maximumPixels: number;
  maximumReferenceImages: number;
}

export function publicCharacterReplaceConfig(
  config: CharacterReplaceConfig,
  currency: { code: string; symbol: string },
  pricingAvailable: boolean,
): CharacterReplacePublicConfig {
  const on = config.qualities.filter((q) => q.enabled);
  const balanced = on.find((q) => q.id === "720p") ?? on[0]!;
  const modes: CharacterReplacePublicMode[] = (["face_only", "skin_face", "full_character"] as const).map((id) => {
    const view = modeConfig(config, id);
    const copy = REPLACEMENT_MODE_COPY[id];
    return {
      id,
      label: copy.label,
      tagline: copy.tagline,
      explanation: copy.explanation,
      enabled: view.enabled,
      tiers: view.tiers.map(({ id: tierId, label, hint, enabled, supported, note }) => ({ id: tierId, label, hint, enabled, supported, note })),
      defaultTier: defaultTierFor(view),
      maximumDurationSeconds: view.maximumDurationSeconds,
      maximumUploadBytes: view.maximumUploadBytes,
      maximumPixels: view.maximumPixels,
      maximumReferenceImages: view.maximumReferenceImages,
    };
  });
  const providerLanguages = new Set(ttsSupportedLanguagesFor(config.tts.model));
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
    modes,
    // Full Character first when it is on: the mode every member of Parts 1–5 knows.
    defaultMode: modes.find((m) => m.enabled && m.id === "full_character")?.id ?? modes.find((m) => m.enabled)?.id ?? "full_character",
    audio: {
      uploadEnabled: config.voice.newVoiceEnabled && config.audio.replacementEnabled,
      maximumDurationSeconds: config.audio.maximumDurationSeconds,
      maximumUploadBytes: config.audio.maximumUploadBytes,
      shorterAudio: config.audio.shorterAudio,
      minimumCoverageFraction: config.audio.minimumCoverageFraction,
    },
    tts: {
      enabled: config.voice.newVoiceEnabled && config.tts.enabled,
      minimumCharacters: config.tts.minimumCharacters,
      maximumCharacters: config.tts.maximumCharacters,
      languages: config.languages.map((l) => l.code).filter((code) => providerLanguages.has(code)),
    },
    lipSyncMaximumDurationSeconds: Math.min(config.lipSyncMaximumDurationSeconds, config.maximumDurationSeconds),
    retention: config.retention,
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
export function versionCharacterReplacePricing(
  current: CharacterReplaceConfig,
  next: CharacterReplaceConfig,
  meta: { changedBy?: string | null; reason?: string | null } = {},
): CharacterReplaceConfig {
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
      modes: {
        face_only: { enabled: current.modes.face_only.enabled, tiers: current.modes.face_only.tiers.map((t) => ({ id: t.id, perSecondCents: t.perSecondCents, enabled: t.enabled })) },
        skin_face: { enabled: current.modes.skin_face.enabled, tiers: current.modes.skin_face.tiers.map((t) => ({ id: t.id, perSecondCents: t.perSecondCents, enabled: t.enabled })) },
      },
      tts: { enabled: current.tts.enabled, perRequestCents: current.tts.perRequestCents, perCharacterCents: current.tts.perCharacterCents },
    },
    // Part 6 §27: the record of who and why, kept beside the old numbers.
    changedBy: meta.changedBy ?? null,
    reason: meta.reason ?? null,
  };
  return {
    ...stamped,
    pricingVersion: current.pricingVersion + 1,
    pricingUpdatedAt: now,
    pricingHistory: [...current.pricingHistory, superseded].slice(-20),
  };
}
