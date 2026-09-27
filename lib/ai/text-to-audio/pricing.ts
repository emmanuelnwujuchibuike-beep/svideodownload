import type { AiPlansConfig } from "@/lib/ai/credits/config";
import { calculateCredits, type CreditEstimate } from "@/lib/ai/credits/engine";
import type { TextToAudioConfig, TextToAudioRoute } from "@/lib/ai/text-to-audio/config";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  TEXT TO AUDIO — the price of one generation (pure)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The brief (§2): "model used · number of characters · provider cost estimate
 * · customer charge · quality multiplier · minimum charge — server-side,
 * never trusted from the browser." And the owner: "500 free characters a
 * month for free and all sub users."
 *
 * So a quote is made from FOUR facts the server holds — the character count
 * of the text it was given, the active route's model, how many of this
 * month's free characters the member still has, and today's prices — and
 * nothing the client says changes it. The browser's "estimate" is this very
 * function's answer from /quote; Generate recomputes it and refuses a
 * mismatch (PRICE_CHANGED), exactly as the video tools do.
 *
 *   billable  = characters − freeCovered              (never below 0)
 *   speech    = ceil(billable × perCharacter × quality)
 *   request   = perRequest                            (only when billable > 0)
 *   total     = max(speech + request, minimum)        (0 when fully free)
 *
 * A fully covered generation is FREE and reserves nothing; the minimum charge
 * never applies to it (a "minimum" on a free thing would be a charge).
 */
export interface TextToAudioQuoteInput {
  characters: number;
  /** This month's free characters still unused, as the server read them a moment ago. */
  freeCharactersAvailable: number;
}

export interface TextToAudioQuoteLine {
  key: "free" | "characters" | "request" | "minimum";
  label: string;
  amountCents: number;
  /** For the `free` line: how many characters it covers (an information line, amount 0). */
  characters?: number;
}

export interface TextToAudioQuote {
  characters: number;
  freeCharactersCovered: number;
  billableCharacters: number;
  route: TextToAudioRoute;
  model: string;
  perCharacterCents: number;
  qualityMultiplier: number;
  lines: TextToAudioQuoteLine[];
  totalCents: number;
  currency: string;
  pricingConfigVersion: number;
  /** The operator's provider-cost figure for the whole text (free characters cost the operator too); null when unknown. */
  providerCostEstimateUsdCents: number | null;
}

export function quoteTextToAudio(input: TextToAudioQuoteInput, config: TextToAudioConfig, money: { currency: string }): TextToAudioQuote {
  const route = config.route;
  const choice = config.models[route];
  const characters = Math.max(0, Math.round(input.characters));
  const covered = Math.max(0, Math.min(characters, Math.round(input.freeCharactersAvailable)));
  const billable = characters - covered;
  const lines: TextToAudioQuoteLine[] = [];
  if (covered > 0) lines.push({ key: "free", label: `Free this month · ${covered} character${covered === 1 ? "" : "s"}`, amountCents: 0, characters: covered });
  let total = 0;
  if (billable > 0) {
    const speech = Math.ceil(billable * choice.perCharacterCents * choice.qualityMultiplier);
    lines.push({ key: "characters", label: `Speech · ${billable} character${billable === 1 ? "" : "s"}`, amountCents: speech });
    if (choice.perRequestCents > 0) lines.push({ key: "request", label: "Per generation", amountCents: choice.perRequestCents });
    total = speech + (choice.perRequestCents > 0 ? choice.perRequestCents : 0);
    if (total < config.minimumChargeCents) {
      lines.push({ key: "minimum", label: "Minimum charge", amountCents: config.minimumChargeCents - total });
      total = config.minimumChargeCents;
    }
  }
  const cost = choice.providerCostPerCharacterUsdCents > 0 ? Math.round(characters * choice.providerCostPerCharacterUsdCents * 100) / 100 : null;
  return {
    characters,
    freeCharactersCovered: covered,
    billableCharacters: billable,
    route,
    model: choice.model,
    perCharacterCents: choice.perCharacterCents,
    qualityMultiplier: choice.qualityMultiplier,
    lines,
    totalCents: total,
    currency: money.currency,
    pricingConfigVersion: config.pricingVersion,
    providerCostEstimateUsdCents: cost,
  };
}

/** The credits a paid part of the quote would take from a plan — the one engine, this tool's multiplier. */
export function textToAudioCredits(quote: TextToAudioQuote, config: TextToAudioConfig, plans: AiPlansConfig): CreditEstimate {
  const mult = config.models[quote.route].creditMultiplier;
  const scaled = mult === 1 ? quote.totalCents : Math.round(quote.totalCents * mult);
  return calculateCredits(
    {
      feature: "ai_text_to_audio",
      priceCents: scaled,
      mode: "text_to_audio",
      durationMs: null,
      lines: quote.lines.filter((l) => l.amountCents > 0).map((l) => ({ label: l.label, cents: Math.round(l.amountCents * mult) })),
    },
    plans,
  );
}

/** What leaves the server: the route's vendor and model and the operator's cost stay behind. */
export function publicTextToAudioQuote(q: TextToAudioQuote) {
  const { route: _r, model: _m, providerCostEstimateUsdCents: _c, ...shown } = q;
  void _r;
  void _m;
  void _c;
  return shown;
}

/**
 * The calendar month a generation belongs to, in the operator's zone (the
 * same zone the credit day and week roll over in). "2026-09" — a stable,
 * sortable key for `ai_tta_free_usage`.
 */
export function textToAudioMonthKey(now: Date, timezone: string): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit" }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "2-digit" }).formatToParts(now);
  }
  const y = parts.find((p) => p.type === "year")?.value ?? String(now.getUTCFullYear());
  const m = parts.find((p) => p.type === "month")?.value ?? String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Characters as ElevenLabs counts them for billing — every UTF-16 unit of the trimmed text. */
export function countTextToAudioCharacters(text: string): number {
  return text.trim().length;
}
