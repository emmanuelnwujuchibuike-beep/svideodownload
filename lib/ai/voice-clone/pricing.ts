import type { AiPlansConfig } from "@/lib/ai/credits/config";
import { calculateCredits, type CreditEstimate } from "@/lib/ai/credits/engine";
import type { VoiceCloneConfig } from "@/lib/ai/voice-clone/config";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  VOICE CLONING — the price of one voice (pure)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A clone is priced per VOICE, not per second and not per character: making it
 * is one operation whose cost does not move with the length of the samples.
 * That is the whole calculation, and keeping it that simple is deliberate —
 * a member deciding whether to clone their voice should be able to read the
 * price in one line.
 *
 *   covered  = this month's free voices, if any are left        (0 or 1)
 *   voice    = perClone                                        (0 when covered)
 *   total    = max(voice, minimum)                             (0 when covered)
 *
 * A covered clone is FREE and reserves nothing; the minimum charge never
 * applies to it, for the same reason it does not in Text to Audio — a
 * "minimum" on a free thing is a charge.
 *
 * ── 🔴 THE SAMPLES ARE NOT PRICED, AND THAT IS A DECISION ───────────────────
 * It would be easy to bill per second of sample, and it would be wrong twice
 * over: the provider does not charge that way for instant cloning, and a
 * member who gives us MORE audio gets a BETTER voice. Charging for the thing
 * that improves the result would make the product worse at the exact moment
 * the member is trying to make it better.
 */
export interface VoiceCloneQuoteInput {
  /** How many of this month's free voices the member still has, as the server read them a moment ago. */
  freeClonesAvailable: number;
}

export interface VoiceCloneQuoteLine {
  key: "free" | "voice" | "minimum";
  label: string;
  amountCents: number;
}

export interface VoiceCloneQuote {
  freeCovered: boolean;
  perCloneCents: number;
  lines: VoiceCloneQuoteLine[];
  totalCents: number;
  currency: string;
  pricingConfigVersion: number;
  /** The operator's own cost figure for one clone; null when unknown. */
  providerCostEstimateUsdCents: number | null;
}

export function quoteVoiceClone(input: VoiceCloneQuoteInput, config: VoiceCloneConfig, money: { currency: string }): VoiceCloneQuote {
  const covered = config.freeClonesPerMonth > 0 && input.freeClonesAvailable > 0;
  const lines: VoiceCloneQuoteLine[] = [];
  let total = 0;
  if (covered) {
    lines.push({ key: "free", label: "Free this month · one voice", amountCents: 0 });
  } else {
    lines.push({ key: "voice", label: "Voice clone", amountCents: config.perCloneCents });
    total = config.perCloneCents;
    if (total < config.minimumChargeCents) {
      lines.push({ key: "minimum", label: "Minimum charge", amountCents: config.minimumChargeCents - total });
      total = config.minimumChargeCents;
    }
  }
  return {
    freeCovered: covered,
    perCloneCents: config.perCloneCents,
    lines,
    totalCents: total,
    currency: money.currency,
    pricingConfigVersion: config.pricingVersion,
    // the operator's cost is per clone whether or not the member paid — a free voice costs us the same
    providerCostEstimateUsdCents: config.providerCostPerCloneUsdCents > 0 ? Math.round(config.providerCostPerCloneUsdCents * 100) / 100 : null,
  };
}

/** The credits a paid clone would take from a plan — the one engine, this tool's multiplier. */
export function voiceCloneCredits(quote: VoiceCloneQuote, config: VoiceCloneConfig, plans: AiPlansConfig): CreditEstimate {
  const mult = config.creditMultiplier;
  const scaled = mult === 1 ? quote.totalCents : Math.round(quote.totalCents * mult);
  return calculateCredits(
    {
      feature: "ai_voice_clone",
      priceCents: scaled,
      mode: "voice_clone",
      durationMs: null,
      lines: quote.lines.filter((l) => l.amountCents > 0).map((l) => ({ label: l.label, cents: Math.round(l.amountCents * mult) })),
    },
    plans,
  );
}

/** What leaves the server: the operator's cost figure stays behind. */
export function publicVoiceCloneQuote(q: VoiceCloneQuote) {
  const { providerCostEstimateUsdCents: _c, ...shown } = q;
  void _c;
  return shown;
}

/**
 * The calendar month a clone belongs to, in the operator's zone — the same
 * zone the credit day and week roll over in, and the same function shape Text
 * to Audio uses for its characters. "2026-09".
 */
export function voiceCloneMonthKey(now: Date, timezone: string): string {
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
