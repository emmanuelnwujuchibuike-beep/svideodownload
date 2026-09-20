import {
  modeConfig,
  type CharacterReplaceAudioMode,
  type CharacterReplaceConfig,
  type CharacterReplaceLipSyncTier,
  type CharacterReplaceQualityId,
} from "@/lib/ai/character-replace/config";
import { isReplacementMode, replacementModeLabel, type ReplacementMode, type ReplacementTierId } from "@/lib/ai/character-replace/modes";
import type { PricingLine, PricingSaving } from "@/lib/ai/character-replace/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CHARACTER REPLACE — the pricing engine (every mode, one arithmetic)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-13 (Part 3, §5): "The backend must calculate the
 * authoritative price… The frontend should submit the user's configuration."
 * Face Only brief §8 / Skin + Face brief: "Do not duplicate billing logic.
 * Create a reusable pricing/billing service that both replacement modes can
 * use." Part 6 §11: "Do NOT create another wallet… The existing Character
 * Replace pricing engine should calculate the complete price before
 * processing."
 *
 * This module IS that calculation, as a pure function of (what was chosen,
 * the operator's configuration, the money). No DB, no env, no React — so the
 * quote route, the reservation at /start and the tests all run the same
 * arithmetic, and a snapshot can be recomputed and compared later.
 *
 * ── The formula, with every mode ──────────────────────────────────────────
 *
 *   video      = seconds × tierRate
 *                full_character: tier.perSecondCents ?? base × tier.multiplier   (Part 3, unchanged)
 *                face_only / skin_face: the mode's own tier rate                 (duration × quality_rate)
 *   voice      = seconds × voiceSurcharge                     (new voice)
 *              + ttsPerRequest + characters × ttsPerCharacter (new voice from text)
 *              + seconds × voiceChangePerSecond                (your audio, re-voiced — 2026-09-20)
 *   lipSync    = seconds × tier.perSecondCents                (new voice + a tier)
 *   subtotal   = basePrice + video + voice + lipSync
 *   total      = max(subtotal, minimumCharge)
 *
 * "seconds" is the SELECTED (trimmed) duration (§8), carried as integer
 * milliseconds and multiplied before division so nothing is lost to a
 * float. Every line rounds UP to the minor unit: the product never bills a
 * fraction of a kobo, and never rounds a member's price down to a number
 * that would not cover the work. The displayed "12.4s × ₦25/s" is printed
 * from the same integers.
 *
 * ── What this never does ───────────────────────────────────────────────────
 *
 * It does not read a price from the caller. `QuoteInput` has no amount in it.
 * It does not know provider costs (§9/§10; Skin + Face §7: provider cost is
 * recorded on the JOB by the server at /start, never on the quote a browser
 * holds). It does not pick a tier the operator has switched off, and it
 * does not price a tier the provider cannot honour: `validateQuoteInput`
 * refuses before `quoteCharacterReplace` runs.
 */

export const CHARACTER_REPLACE_PRODUCT = "character_replace" as const;

/** Any tier id a mode may carry: Full Character's resolutions, or the two new modes' tiers. */
export type CharacterReplaceAnyQuality = CharacterReplaceQualityId | ReplacementTierId;

/** Where a new voice comes from (Part 6 §3/§5). */
export type CharacterReplaceVoiceSource = "upload" | "tts";

/** What the member chose. Every field is checked against the configuration first. */
export interface QuoteInput {
  /** Integer milliseconds of the KEPT range. */
  selectedDurationMs: number;
  /** Absent = Full Character — every quote made before Part 6 was one. */
  mode?: ReplacementMode;
  quality: CharacterReplaceAnyQuality;
  voiceMode: CharacterReplaceAudioMode;
  /** Required with a new voice; ignored with the original audio. */
  voiceSource?: CharacterReplaceVoiceSource | null;
  /** Characters of dialogue, when the voice is generated from text. */
  ttsCharacters?: number | null;
  /** 2026-09-20: the member's own recording, re-voiced in a catalogue voice. Only with `voiceSource: "upload"`. */
  voiceChange?: boolean | null;
  /** Null unless a new voice is generated. */
  lipSyncMode: CharacterReplaceLipSyncTier | null;
}

/** The input with its defaults applied — the shape everything below reads. */
export interface NormalizedQuoteInput {
  selectedDurationMs: number;
  mode: ReplacementMode;
  quality: CharacterReplaceAnyQuality;
  voiceMode: CharacterReplaceAudioMode;
  voiceSource: CharacterReplaceVoiceSource | null;
  ttsCharacters: number;
  voiceChange: boolean;
  lipSyncMode: CharacterReplaceLipSyncTier | null;
}

export function normalizeQuoteInput(input: QuoteInput): NormalizedQuoteInput {
  const mode = isReplacementMode(input.mode) ? input.mode : "full_character";
  const newVoice = input.voiceMode === "new_voice";
  return {
    selectedDurationMs: input.selectedDurationMs,
    mode,
    quality: input.quality,
    voiceMode: input.voiceMode,
    voiceSource: newVoice ? (input.voiceSource === "tts" ? "tts" : input.voiceSource === "upload" ? "upload" : null) : null,
    ttsCharacters: newVoice && input.voiceSource === "tts" && typeof input.ttsCharacters === "number" && Number.isInteger(input.ttsCharacters) && input.ttsCharacters > 0 ? input.ttsCharacters : 0,
    voiceChange: newVoice && input.voiceSource === "upload" && input.voiceChange === true,
    lipSyncMode: newVoice ? input.lipSyncMode : null,
  };
}

/**
 * The immutable pricing snapshot (§15; Part 6 §13): every rate that produced
 * the total, beside the total, beside the version of the configuration it
 * came from. Stored on the ledger row at reservation (Part 4) and never
 * recomputed.
 */
export interface CharacterReplaceQuote {
  /** Opaque, server-issued; a signature over the fields (wallet.ts). */
  id: string;
  product: typeof CHARACTER_REPLACE_PRODUCT;
  currency: string;
  symbol: string;
  pricingConfigVersion: number;
  createdAt: string;
  expiresAt: string;

  durationMs: number;
  mode: ReplacementMode;
  quality: CharacterReplaceAnyQuality;
  voiceMode: CharacterReplaceAudioMode;
  voiceSource: CharacterReplaceVoiceSource | null;
  ttsCharacters: number;
  /** 2026-09-20: whether the uploaded voice is re-voiced in a catalogue voice. Signed. */
  voiceChange: boolean;
  lipSyncMode: CharacterReplaceLipSyncTier | null;

  /** The rates that applied, per second, in minor units. */
  baseRateCents: number;
  qualityRateCents: number;
  voiceRateCents: number;
  lipSyncRateCents: number;
  basePriceCents: number;
  /** The text-to-speech fees that applied (Part 6 §26). */
  ttsRequestCents: number;
  ttsCharacterRateCents: number;
  /** The voice-change rate per second that applied (2026-09-20); zero when no change. */
  voiceChangeRateCents: number;

  /** The amounts, in minor units. */
  videoCents: number;
  voiceCents: number;
  lipSyncCents: number;
  subtotalCents: number;
  minimumChargeCents: number;
  minimumApplied: boolean;
  totalCents: number;

  /** "12.4s × ₦25/s = ₦310" — the arithmetic of the video line, printed from the integers. */
  rateLine: string;

  /** The rows the summary prints, and the informative sentences under them. */
  lines: readonly PricingLine[];
  savings: readonly PricingSaving[];
}

export type QuoteInputVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Whether the chosen configuration is one the operator currently offers.
 *
 * 🔴 Refuses, never substitutes. A quality that is switched off is not
 * silently priced as another one (Part 4 brief: "Do NOT silently downgrade
 * 1080p to 720p"); a tier the provider cannot honour is refused even if an
 * operator switched it on; a lip-sync tier without a new voice is a
 * contradiction, not a free upgrade; a new voice with no source is not a
 * voice. The reason is a sentence the route may return.
 */
export function validateQuoteInput(raw: QuoteInput, config: CharacterReplaceConfig): QuoteInputVerdict {
  // A contradiction in the RAW input is refused before the defaults are applied: a tier with the original audio is not a free upgrade.
  if (raw.lipSyncMode !== null && raw.lipSyncMode !== undefined && raw.voiceMode !== "new_voice") return { ok: false, reason: "Lip sync needs a new voice." };
  if (raw.mode !== undefined && !isReplacementMode(raw.mode)) return { ok: false, reason: "That replacement type isn't valid." };
  const input = normalizeQuoteInput(raw);
  if (!config.enabled) return { ok: false, reason: "Character Replace isn't available right now." };
  const view = modeConfig(config, input.mode);
  if (!view.enabled) return { ok: false, reason: `${replacementModeLabel(input.mode)} isn't available right now.` };
  if (!Number.isInteger(input.selectedDurationMs) || input.selectedDurationMs <= 0) {
    return { ok: false, reason: "The selected duration isn't valid." };
  }
  const minMs = Math.round(config.trim.minimumSeconds * 1000);
  const maxMs = Math.round(view.maximumDurationSeconds * 1000);
  if (input.selectedDurationMs < minMs) return { ok: false, reason: `Keep at least ${config.trim.minimumSeconds} seconds.` };
  if (input.selectedDurationMs > maxMs) return { ok: false, reason: `Keep ${view.maximumDurationSeconds} seconds or less for ${replacementModeLabel(input.mode)}.` };
  const tier = view.tiers.find((t) => t.id === input.quality);
  if (!tier || !tier.enabled || !tier.supported) return { ok: false, reason: "That quality isn't available right now." };
  if (input.voiceMode !== "original" && input.voiceMode !== "new_voice") return { ok: false, reason: "That audio option isn't valid." };
  if (input.voiceMode === "new_voice") {
    if (!config.voice.newVoiceEnabled) return { ok: false, reason: "A new voice isn't available right now." };
    if (input.voiceSource === null) return { ok: false, reason: "Choose where the new voice comes from." };
    if (input.voiceSource === "upload" && !config.audio.replacementEnabled) return { ok: false, reason: "Uploading your own audio isn't available right now." };
    if (input.voiceChange) {
      if (input.voiceSource !== "upload") return { ok: false, reason: "A voice change needs your own audio." };
      if (!config.tts.voiceChange.enabled) return { ok: false, reason: "Changing the voice isn't available right now." };
    }
    if (input.voiceSource === "tts") {
      if (!config.tts.enabled) return { ok: false, reason: "Generating a voice from text isn't available right now." };
      if (input.ttsCharacters < config.tts.minimumCharacters) return { ok: false, reason: `Write at least ${config.tts.minimumCharacters} character${config.tts.minimumCharacters === 1 ? "" : "s"} of dialogue.` };
      if (input.ttsCharacters > config.tts.maximumCharacters) return { ok: false, reason: `Keep the dialogue to ${config.tts.maximumCharacters} characters or fewer.` };
    }
  }
  if (input.lipSyncMode !== null) {
    if (input.voiceMode !== "new_voice") return { ok: false, reason: "Lip sync needs a new voice." };
    if (!config.lipSyncEnabled) return { ok: false, reason: "Lip sync isn't available right now." };
    const lip = config.lipSync.find((l) => l.id === input.lipSyncMode);
    if (!lip || !lip.enabled) return { ok: false, reason: "That lip sync option isn't available right now." };
    if (input.selectedDurationMs > Math.round(config.lipSyncMaximumDurationSeconds * 1000)) {
      return { ok: false, reason: `Lip sync works on videos up to ${config.lipSyncMaximumDurationSeconds} seconds. Trim the video or switch lip sync off.` };
    }
  }
  return { ok: true };
}

/** `rate` per second × `ms` milliseconds, rounded UP to the minor unit. Integer arithmetic. */
export function centsForDuration(ratePerSecondCents: number, durationMs: number): number {
  if (ratePerSecondCents <= 0 || durationMs <= 0) return 0;
  return Math.ceil((ratePerSecondCents * durationMs) / 1000);
}

/**
 * The per-second rate a Full Character quality tier bills: its own rate, or
 * the base × multiplier, rounded up. Kept by name for Part 3's callers and
 * tests; `tierRateCents` is the mode-aware version.
 */
export function qualityRateCents(config: CharacterReplaceConfig, quality: CharacterReplaceQualityId): number {
  const tier = config.qualities.find((q) => q.id === quality);
  if (!tier) return 0;
  if (tier.perSecondCents !== null) return tier.perSecondCents;
  return Math.ceil(config.pricePerSecondCents * tier.multiplier);
}

/** The per-second rate of any mode's tier. Zero for a tier the mode does not have. */
export function tierRateCents(config: CharacterReplaceConfig, mode: ReplacementMode, quality: CharacterReplaceAnyQuality): number {
  if (mode === "full_character") return qualityRateCents(config, quality as CharacterReplaceQualityId);
  return modeConfig(config, mode).tiers.find((t) => t.id === quality)?.perSecondCents ?? 0;
}

/** The arithmetic alone — the numbers every other function here is built from. */
function computeAmounts(input: NormalizedQuoteInput, config: CharacterReplaceConfig) {
  const ms = input.selectedDurationMs;
  const newVoice = input.voiceMode === "new_voice";
  const tts = newVoice && input.voiceSource === "tts";
  const lipTier = newVoice && input.lipSyncMode ? (config.lipSync.find((l) => l.id === input.lipSyncMode) ?? null) : null;
  const qualityRate = tierRateCents(config, input.mode, input.quality);
  const voiceRate = newVoice ? config.voice.surchargePerSecondCents : 0;
  const lipRate = lipTier ? lipTier.perSecondCents : 0;
  const ttsRequestCents = tts ? config.tts.perRequestCents : 0;
  const ttsCharacterRateCents = tts ? config.tts.perCharacterCents : 0;
  const voiceChange = newVoice && input.voiceSource === "upload" && input.voiceChange;
  const voiceChangeRateCents = voiceChange ? config.tts.voiceChange.perSecondCents : 0;
  const videoCents = centsForDuration(qualityRate, ms);
  const ttsCents = tts ? ttsRequestCents + ttsCharacterRateCents * input.ttsCharacters : 0;
  const voiceChangeCents = centsForDuration(voiceChangeRateCents, ms);
  const voiceCents = centsForDuration(voiceRate, ms) + ttsCents + voiceChangeCents;
  const lipSyncCents = centsForDuration(lipRate, ms);
  const subtotalCents = config.basePriceCents + videoCents + voiceCents + lipSyncCents;
  const minimumApplied = subtotalCents < config.minimumChargeCents;
  const totalCents = minimumApplied ? config.minimumChargeCents : subtotalCents;
  return { ms, newVoice, tts, voiceChange, voiceChangeRateCents, voiceChangeCents, lipTier, qualityRate, voiceRate, lipRate, ttsRequestCents, ttsCharacterRateCents, ttsCents, videoCents, voiceCents, lipSyncCents, subtotalCents, minimumApplied, totalCents };
}

/** "12.4s" — one decimal, from integer milliseconds. */
export function formatSecondsShort(ms: number): string {
  return `${(Math.round(ms / 100) / 10).toFixed(1)}s`;
}

/** "12.4s × ₦25/s = ₦310" (Skin + Face brief §13). */
export function rateLineFor(ms: number, ratePerSecondCents: number, amountCents: number, symbol: string): string {
  return `${formatSecondsShort(ms)} × ${format(ratePerSecondCents, symbol)}/s = ${format(amountCents, symbol)}`;
}

/** What the replacement line is called, per mode. */
function replacementLabel(mode: ReplacementMode): string {
  switch (mode) {
    case "face_only":
      return "Face replacement";
    case "skin_face":
      return "Identity & skin transfer";
    case "full_character":
      return "Character replacement";
  }
}

/**
 * The quote. Call `validateQuoteInput` first; this trusts its input to be a
 * configuration the operator offers and prices it.
 */
export function quoteCharacterReplace(
  raw: QuoteInput,
  config: CharacterReplaceConfig,
  money: { currency: string; symbol: string; now?: Date; id?: string; ttlMs?: number },
): CharacterReplaceQuote {
  const input = normalizeQuoteInput(raw);
  const now = money.now ?? new Date();
  const a = computeAmounts(input, config);
  const baseRateCents = config.pricePerSecondCents;
  const view = modeConfig(config, input.mode);
  const tier = view.tiers.find((t) => t.id === input.quality);
  const qualityLabel = tier?.label ?? input.quality;
  const seconds = `${(Math.round(a.ms / 100) / 10).toFixed(1)} sec`;
  const rateLine = rateLineFor(a.ms, a.qualityRate, a.videoCents, money.symbol);

  const lines: PricingLine[] = [
    { key: "video", label: "Video processing", value: `${seconds} · ${qualityLabel} · ${format(a.qualityRate, money.symbol)}/sec`, amountCents: a.videoCents },
    { key: "character", label: replacementLabel(input.mode), value: replacementModeLabel(input.mode), amountCents: null },
    {
      key: "voice",
      label: "Voice",
      value: a.newVoice ? (a.tts ? `New voice from text · ${input.ttsCharacters} characters` : a.voiceChange ? "Your audio, in a new voice" : "Your audio") : "Original audio",
      amountCents: a.newVoice ? a.voiceCents : null,
    },
    {
      key: "lipSync",
      label: "Lip sync",
      value: a.lipTier ? a.lipTier.label : "Not selected",
      amountCents: a.lipTier ? a.lipSyncCents : null,
    },
  ];
  if (config.basePriceCents > 0) lines.unshift({ key: "base", label: "Processing", value: "Per video", amountCents: config.basePriceCents });
  if (a.minimumApplied) lines.push({ key: "minimum", label: "Minimum charge", value: "Applied", amountCents: a.totalCents - a.subtotalCents });

  /*
    The informative sentences (§10, Part 1): what a DIFFERENT choice would
    save, computed by the same arithmetic — never a guess, never an upsell.
    Only the cheaper alternatives are named, only when they are cheaper, and
    only within the same mode.
  */
  const savings: PricingSaving[] = [];
  const cheaper = view.tiers
    /*
      Never "save money with 480p" (Part 9, 2026-09-14): every Full Character
      result the owner called unclear was a 480p run — the tier generates the
      whole video at a lower resolution, faces come out soft, and a saving
      that costs the result is not a saving. The line still names 720p when
      1080p is chosen, and Face Only / Skin + Face tiers as before.
    */
    .filter((t) => t.enabled && t.supported && t.id !== input.quality && t.perSecondCents < a.qualityRate && !(input.mode === "full_character" && t.id === "480p"))
    .sort((x, y) => y.perSecondCents - x.perSecondCents)[0];
  if (cheaper) {
    const alt = quoteTotal({ ...input, quality: cheaper.id as CharacterReplaceAnyQuality }, config);
    if (alt < a.totalCents) {
      savings.push({ message: `You save ${format(a.totalCents - alt, money.symbol)} by choosing ${cheaper.label} instead of ${qualityLabel}.`, savesCents: a.totalCents - alt });
    }
  }
  if (a.lipTier && a.lipTier.id === "studio") {
    const standard = config.lipSync.find((l) => l.id === "standard" && l.enabled);
    if (standard) {
      const alt = quoteTotal({ ...input, lipSyncMode: "standard" }, config);
      if (alt < a.totalCents) savings.push({ message: `Standard lip sync would save ${format(a.totalCents - alt, money.symbol)}.`, savesCents: a.totalCents - alt });
    }
  }

  return {
    id: money.id ?? "",
    product: CHARACTER_REPLACE_PRODUCT,
    currency: money.currency,
    symbol: money.symbol,
    pricingConfigVersion: config.pricingVersion,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + (money.ttlMs ?? QUOTE_TTL_MS)).toISOString(),
    durationMs: a.ms,
    mode: input.mode,
    quality: input.quality,
    voiceMode: input.voiceMode,
    voiceSource: input.voiceSource,
    ttsCharacters: input.ttsCharacters,
    voiceChange: a.voiceChange,
    lipSyncMode: a.lipTier ? a.lipTier.id : null,
    baseRateCents,
    qualityRateCents: a.qualityRate,
    voiceRateCents: a.voiceRate,
    lipSyncRateCents: a.lipRate,
    basePriceCents: config.basePriceCents,
    ttsRequestCents: a.ttsRequestCents,
    ttsCharacterRateCents: a.ttsCharacterRateCents,
    voiceChangeRateCents: a.voiceChangeRateCents,
    videoCents: a.videoCents,
    voiceCents: a.voiceCents,
    lipSyncCents: a.lipSyncCents,
    subtotalCents: a.subtotalCents,
    minimumChargeCents: config.minimumChargeCents,
    minimumApplied: a.minimumApplied,
    totalCents: a.totalCents,
    rateLine,
    lines,
    savings,
  };
}

/** Ten minutes: long enough to read and confirm, short enough that a price change lands. */
export const QUOTE_TTL_MS = 10 * 60 * 1000;

/** The total alone, for the savings comparisons and the server's re-check at /start. */
export function quoteTotal(input: QuoteInput, config: CharacterReplaceConfig): number {
  return computeAmounts(normalizeQuoteInput(input), config).totalCents;
}

/**
 * The operator's estimate of what the provider will bill for this job, in
 * US cents (Skin + Face brief §7): `duration × providerCostPerSecondUsdCents`
 * for the replacement stage, plus the lip-sync provider's published rate
 * when a tier is chosen. NEVER on the quote a browser receives — the server
 * records it on the job at /start (job-meta `provider_cost_estimate`) and the
 * admin monitor prints it beside the customer charge. Null when the
 * operator has not entered an estimate.
 */
export function providerCostEstimateUsdCents(
  input: QuoteInput,
  config: CharacterReplaceConfig,
  lipSyncUsdCentsPerSecond: (tier: CharacterReplaceLipSyncTier) => number,
): { replaceUsdCents: number; lipSyncUsdCents: number; totalUsdCents: number } | null {
  const n = normalizeQuoteInput(input);
  const view = modeConfig(config, n.mode);
  const replaceRate = view.providerCostPerSecondUsdCents;
  const lipRate = n.lipSyncMode ? lipSyncUsdCentsPerSecond(n.lipSyncMode) : 0;
  if (replaceRate <= 0 && lipRate <= 0) return null;
  const replaceUsdCents = Math.ceil((replaceRate * n.selectedDurationMs) / 1000);
  const lipSyncUsdCents = Math.ceil((lipRate * n.selectedDurationMs) / 1000);
  return { replaceUsdCents, lipSyncUsdCents, totalUsdCents: replaceUsdCents + lipSyncUsdCents };
}

function format(cents: number, symbol: string): string {
  const abs = Math.abs(Math.round(cents));
  const major = Math.floor(abs / 100).toLocaleString("en-US");
  const minor = String(abs % 100).padStart(2, "0");
  return `${symbol}${major}.${minor}`;
}

/**
 * "Insufficient balance — Required / Available / Short by" (§14), as facts.
 * Pure, so the review step and the route agree on the arithmetic.
 */
export function affordability(totalCents: number, balanceCents: number): {
  sufficient: boolean;
  shortfallCents: number;
  afterCents: number;
} {
  const shortfall = Math.max(0, totalCents - balanceCents);
  return { sufficient: shortfall === 0, shortfallCents: shortfall, afterCents: Math.max(0, balanceCents - totalCents) };
}
