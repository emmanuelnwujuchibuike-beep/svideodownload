import type {
  CharacterReplaceAudioMode,
  CharacterReplaceConfig,
  CharacterReplaceLipSyncTier,
  CharacterReplaceQualityId,
} from "@/lib/ai/character-replace/config";
import type { PricingLine, PricingSaving } from "@/lib/ai/character-replace/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CHARACTER REPLACE — the pricing engine
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-13 (Part 3, §5): "The backend must calculate the
 * authoritative price… The frontend should submit the user's configuration."
 *
 * This module IS that calculation, as a pure function of (what was chosen,
 * the operator's configuration, the money). No DB, no env, no React — so the
 * quote route, the reservation at /start (Part 4) and the tests all run the
 * same arithmetic, and a snapshot can be recomputed and compared later.
 *
 * ── The formula (§7), with both models the brief asks for ──────────────────
 *
 *   video      = seconds × qualityRate
 *                qualityRate = tier.perSecondCents ?? base × tier.multiplier
 *   voice      = seconds × voiceSurcharge        (new voice only)
 *   lipSync    = seconds × tier.perSecondCents   (new voice + a tier only)
 *   subtotal   = basePrice + video + voice + lipSync
 *   total      = max(subtotal, minimumCharge)
 *
 * "seconds" is the SELECTED (trimmed) duration (§8), carried as integer
 * milliseconds and multiplied before division so nothing is lost to a
 * float. Every line rounds UP to the minor unit: the product never bills a
 * fraction of a kobo, and never rounds a member's price down to a number
 * that would not cover the work.
 *
 * ── What this never does ───────────────────────────────────────────────────
 *
 * It does not read a price from the caller. `QuoteInput` has no amount in it.
 * It does not know provider costs (§9/§10: "Do not expose internal
 * model/provider costs" — there are none here to expose). It does not pick a
 * tier the operator has switched off: `validateQuoteInput` refuses before
 * `quoteCharacterReplace` runs.
 */

export const CHARACTER_REPLACE_PRODUCT = "character_replace" as const;

/** What the member chose. Every field is checked against the configuration first. */
export interface QuoteInput {
  /** Integer milliseconds of the KEPT range. */
  selectedDurationMs: number;
  quality: CharacterReplaceQualityId;
  voiceMode: CharacterReplaceAudioMode;
  /** Null unless a new voice is generated. */
  lipSyncMode: CharacterReplaceLipSyncTier | null;
}

/**
 * The immutable pricing snapshot (§15): every rate that produced the total,
 * beside the total, beside the version of the configuration it came from.
 * Stored on the ledger row at reservation (Part 4) and never recomputed.
 */
export interface CharacterReplaceQuote {
  /** Opaque, server-issued; a signature over the fields (quote-server.ts). */
  id: string;
  product: typeof CHARACTER_REPLACE_PRODUCT;
  currency: string;
  symbol: string;
  pricingConfigVersion: number;
  createdAt: string;
  expiresAt: string;

  durationMs: number;
  quality: CharacterReplaceQualityId;
  voiceMode: CharacterReplaceAudioMode;
  lipSyncMode: CharacterReplaceLipSyncTier | null;

  /** The rates that applied, per second, in minor units. */
  baseRateCents: number;
  qualityRateCents: number;
  voiceRateCents: number;
  lipSyncRateCents: number;
  basePriceCents: number;

  /** The amounts, in minor units. */
  videoCents: number;
  voiceCents: number;
  lipSyncCents: number;
  subtotalCents: number;
  minimumChargeCents: number;
  minimumApplied: boolean;
  totalCents: number;

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
 * 1080p to 720p"); a lip-sync tier without a new voice is a contradiction,
 * not a free upgrade. The reason is a sentence the route may return.
 */
export function validateQuoteInput(input: QuoteInput, config: CharacterReplaceConfig): QuoteInputVerdict {
  if (!config.enabled) return { ok: false, reason: "Character Replace isn't available right now." };
  if (!Number.isInteger(input.selectedDurationMs) || input.selectedDurationMs <= 0) {
    return { ok: false, reason: "The selected duration isn't valid." };
  }
  const minMs = Math.round(config.trim.minimumSeconds * 1000);
  const maxMs = Math.round(config.maximumDurationSeconds * 1000);
  if (input.selectedDurationMs < minMs) return { ok: false, reason: `Keep at least ${config.trim.minimumSeconds} seconds.` };
  if (input.selectedDurationMs > maxMs) return { ok: false, reason: `Keep ${config.maximumDurationSeconds} seconds or less.` };
  const tier = config.qualities.find((q) => q.id === input.quality);
  if (!tier || !tier.enabled) return { ok: false, reason: "That quality isn't available right now." };
  if (input.voiceMode !== "original" && input.voiceMode !== "new_voice") return { ok: false, reason: "That audio option isn't valid." };
  if (input.voiceMode === "new_voice" && !config.voice.newVoiceEnabled) {
    return { ok: false, reason: "A new voice isn't available right now." };
  }
  if (input.lipSyncMode !== null) {
    if (input.voiceMode !== "new_voice") return { ok: false, reason: "Lip sync needs a new voice." };
    if (!config.lipSyncEnabled) return { ok: false, reason: "Lip sync isn't available right now." };
    const lip = config.lipSync.find((l) => l.id === input.lipSyncMode);
    if (!lip || !lip.enabled) return { ok: false, reason: "That lip sync option isn't available right now." };
  }
  return { ok: true };
}

/** `rate` per second × `ms` milliseconds, rounded UP to the minor unit. Integer arithmetic. */
export function centsForDuration(ratePerSecondCents: number, durationMs: number): number {
  if (ratePerSecondCents <= 0 || durationMs <= 0) return 0;
  return Math.ceil((ratePerSecondCents * durationMs) / 1000);
}

/** The per-second rate a quality tier bills: its own rate, or the base × multiplier, rounded up. */
export function qualityRateCents(config: CharacterReplaceConfig, quality: CharacterReplaceQualityId): number {
  const tier = config.qualities.find((q) => q.id === quality);
  if (!tier) return 0;
  if (tier.perSecondCents !== null) return tier.perSecondCents;
  return Math.ceil(config.pricePerSecondCents * tier.multiplier);
}

/** The arithmetic alone — the numbers every other function here is built from. */
function computeAmounts(input: QuoteInput, config: CharacterReplaceConfig) {
  const ms = input.selectedDurationMs;
  const newVoice = input.voiceMode === "new_voice";
  const lipTier = newVoice && input.lipSyncMode ? (config.lipSync.find((l) => l.id === input.lipSyncMode) ?? null) : null;
  const qualityRate = qualityRateCents(config, input.quality);
  const voiceRate = newVoice ? config.voice.surchargePerSecondCents : 0;
  const lipRate = lipTier ? lipTier.perSecondCents : 0;
  const videoCents = centsForDuration(qualityRate, ms);
  const voiceCents = centsForDuration(voiceRate, ms);
  const lipSyncCents = centsForDuration(lipRate, ms);
  const subtotalCents = config.basePriceCents + videoCents + voiceCents + lipSyncCents;
  const minimumApplied = subtotalCents < config.minimumChargeCents;
  const totalCents = minimumApplied ? config.minimumChargeCents : subtotalCents;
  return { ms, newVoice, lipTier, qualityRate, voiceRate, lipRate, videoCents, voiceCents, lipSyncCents, subtotalCents, minimumApplied, totalCents };
}

/**
 * The quote. Call `validateQuoteInput` first; this trusts its input to be a
 * configuration the operator offers and prices it.
 */
export function quoteCharacterReplace(
  input: QuoteInput,
  config: CharacterReplaceConfig,
  money: { currency: string; symbol: string; now?: Date; id?: string; ttlMs?: number },
): CharacterReplaceQuote {
  const now = money.now ?? new Date();
  const { ms, newVoice, lipTier, qualityRate, voiceRate, lipRate, videoCents, voiceCents, lipSyncCents, subtotalCents, minimumApplied, totalCents } =
    computeAmounts(input, config);
  const baseRateCents = config.pricePerSecondCents;

  const qualityLabel = config.qualities.find((q) => q.id === input.quality)?.label ?? input.quality;
  const seconds = `${(Math.round(ms / 100) / 10).toFixed(1)} sec`;

  const lines: PricingLine[] = [
    { key: "video", label: "Video processing", value: `${seconds} · ${qualityLabel}`, amountCents: videoCents },
    { key: "character", label: "Character replacement", value: "Included", amountCents: null },
    {
      key: "voice",
      label: "Voice",
      value: newVoice ? "New voice" : "Original audio",
      amountCents: newVoice ? voiceCents : null,
    },
    {
      key: "lipSync",
      label: "Lip sync",
      value: lipTier ? lipTier.label : "Not selected",
      amountCents: lipTier ? lipSyncCents : null,
    },
  ];
  if (config.basePriceCents > 0) lines.unshift({ key: "base", label: "Processing", value: "Per video", amountCents: config.basePriceCents });
  if (minimumApplied) lines.push({ key: "minimum", label: "Minimum charge", value: "Applied", amountCents: totalCents - subtotalCents });

  /*
    The informative sentences (§10, Part 1): what a DIFFERENT choice would
    save, computed by the same arithmetic — never a guess, never an upsell.
    Only the cheaper alternatives are named, only when they are cheaper.
  */
  const savings: PricingSaving[] = [];
  const cheaper = config.qualities
    .filter((q) => q.enabled && q.id !== input.quality && qualityRateCents(config, q.id) < qualityRate)
    .sort((a, b) => qualityRateCents(config, b.id) - qualityRateCents(config, a.id))[0];
  if (cheaper) {
    const alt = quoteTotal({ ...input, quality: cheaper.id }, config);
    if (alt < totalCents) {
      savings.push({ message: `You save ${format(totalCents - alt, money.symbol)} by choosing ${cheaper.label} instead of ${qualityLabel}.`, savesCents: totalCents - alt });
    }
  }
  if (lipTier && lipTier.id === "studio") {
    const standard = config.lipSync.find((l) => l.id === "standard" && l.enabled);
    if (standard) {
      const alt = quoteTotal({ ...input, lipSyncMode: "standard" }, config);
      if (alt < totalCents) savings.push({ message: `Standard lip sync would save ${format(totalCents - alt, money.symbol)}.`, savesCents: totalCents - alt });
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
    durationMs: ms,
    quality: input.quality,
    voiceMode: input.voiceMode,
    lipSyncMode: lipTier ? lipTier.id : null,
    baseRateCents,
    qualityRateCents: qualityRate,
    voiceRateCents: voiceRate,
    lipSyncRateCents: lipRate,
    basePriceCents: config.basePriceCents,
    videoCents,
    voiceCents,
    lipSyncCents,
    subtotalCents,
    minimumChargeCents: config.minimumChargeCents,
    minimumApplied,
    totalCents,
    lines,
    savings,
  };
}

/** Ten minutes: long enough to read and confirm, short enough that a price change lands. */
export const QUOTE_TTL_MS = 10 * 60 * 1000;

/** The total alone, for the savings comparisons and the server's re-check at /start. */
export function quoteTotal(input: QuoteInput, config: CharacterReplaceConfig): number {
  return computeAmounts(input, config).totalCents;
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
