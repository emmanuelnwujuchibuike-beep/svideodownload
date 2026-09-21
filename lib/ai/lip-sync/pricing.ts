import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { AiPlansConfig } from "@/lib/ai/credits/config";
import { calculateCredits, type CreditEstimate } from "@/lib/ai/credits/engine";
import type { LipSyncProConfig, LipSyncSpeechSource, LipSyncVendor } from "@/lib/ai/lip-sync/config";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LIP SYNC PRO — the price, the credits, the provider-cost estimate (§10, §11)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "Credit cost should consider output video duration, selected model,
 * quality, text-to-speech requirement, external audio vs generated speech …
 * Text mode: TTS cost + lip-sync cost. External audio: lip-sync cost only.
 * Do not charge the user for TTS when they upload their own audio."
 *
 * One quote = the operator's lines (lib/ai/lip-sync/config.ts): the active
 * model's per-second rate × the kept video length, plus the base amount,
 * plus — for typed text that the VOICE PROVIDER must make — the TTS request
 * and per-character prices. A text-native model speaks the text itself, so
 * no TTS line is charged for it. The credits are the SAME conversion every
 * tool uses (lib/ai/credits/engine.ts), with the model's credit multiplier
 * as the quality factor. Signed like a Character Replace quote: /start
 * re-verifies the signature and recomputes before anything is reserved.
 */
export interface LipSyncQuoteInput {
  /** The kept video length, integer ms (after the member's trim, if any). */
  durationMs: number;
  speechSource: LipSyncSpeechSource;
  /** How the text will be spoken; "audio" for an upload. */
  speechPath: "native" | "tts" | "audio";
  textCharacters: number;
}

export interface LipSyncQuoteLine {
  key: "lipsync" | "base" | "tts_request" | "tts_characters" | "minimum";
  label: string;
  amountCents: number;
}

export interface LipSyncQuote {
  id: string;
  durationMs: number;
  speechSource: LipSyncSpeechSource;
  speechPath: "native" | "tts" | "audio";
  textCharacters: number;
  vendor: LipSyncVendor;
  model: string;
  /** An opaque key for (vendor, model) — what the browser echoes back; the names themselves never leave the server. */
  routeKey: string;
  perSecondCents: number;
  lines: LipSyncQuoteLine[];
  lipSyncCents: number;
  ttsCents: number;
  totalCents: number;
  currency: string;
  pricingConfigVersion: number;
  expiresAt: string;
  /** §11: the operator's provider-cost ESTIMATE, US cents, split — never shown to a member. */
  providerCostEstimate: { lipSyncUsdCents: number | null; ttsUsdCents: number | null; totalUsdCents: number | null };
}

export const LIP_SYNC_QUOTE_TTL_MS = 15 * 60 * 1000;

export function quoteLipSync(input: LipSyncQuoteInput, config: LipSyncProConfig, money: { currency: string }, now: Date = new Date()): LipSyncQuote {
  const vendor = config.provider;
  const choice = config.models[vendor];
  const seconds = Math.max(0, input.durationMs) / 1000;
  const lipSyncCents = Math.ceil(seconds * choice.perSecondCents);
  const lines: LipSyncQuoteLine[] = [{ key: "lipsync", label: `Lip sync · ${seconds % 1 ? seconds.toFixed(1) : seconds} s`, amountCents: lipSyncCents }];
  if (config.basePriceCents > 0) lines.push({ key: "base", label: "Per video", amountCents: config.basePriceCents });
  let ttsCents = 0;
  if (input.speechSource === "text" && input.speechPath === "tts") {
    // §10: the voice provider's work, only when it is asked to do any
    const request = config.tts.perRequestCents;
    const perChar = Math.ceil(input.textCharacters * config.tts.perCharacterCents);
    if (request > 0) lines.push({ key: "tts_request", label: "Generated voice", amountCents: request });
    if (perChar > 0) lines.push({ key: "tts_characters", label: `Speech · ${input.textCharacters} characters`, amountCents: perChar });
    ttsCents = request + perChar;
  }
  let total = lines.reduce((a, l) => a + l.amountCents, 0);
  if (total < config.minimumChargeCents) {
    lines.push({ key: "minimum", label: "Minimum charge", amountCents: config.minimumChargeCents - total });
    total = config.minimumChargeCents;
  }
  const lipSyncUsd = choice.providerCostPerSecondUsdCents > 0 ? Math.round(seconds * choice.providerCostPerSecondUsdCents * 100) / 100 : null;
  const ttsUsd = input.speechSource === "text" && input.speechPath === "tts" && config.tts.providerCostPerCharacterUsdCents > 0 ? Math.round(input.textCharacters * config.tts.providerCostPerCharacterUsdCents * 100) / 100 : input.speechSource === "text" && input.speechPath === "tts" ? null : 0;
  const quote: LipSyncQuote = {
    id: "",
    durationMs: Math.round(input.durationMs),
    speechSource: input.speechSource,
    speechPath: input.speechPath,
    textCharacters: input.speechSource === "text" ? Math.max(0, Math.round(input.textCharacters)) : 0,
    vendor,
    model: choice.model,
    routeKey: lipSyncRouteKey(vendor, choice.model),
    perSecondCents: choice.perSecondCents,
    lines,
    lipSyncCents,
    ttsCents,
    totalCents: total,
    currency: money.currency,
    pricingConfigVersion: config.pricingVersion,
    expiresAt: new Date(now.getTime() + LIP_SYNC_QUOTE_TTL_MS).toISOString(),
    providerCostEstimate: { lipSyncUsdCents: lipSyncUsd, ttsUsdCents: ttsUsd, totalUsdCents: lipSyncUsd === null && ttsUsd === null ? null : Math.round(((lipSyncUsd ?? 0) + (ttsUsd ?? 0)) * 100) / 100 },
  };
  quote.id = signLipSyncQuote(quote);
  return quote;
}

/** The SAME engine every tool uses; the model's multiplier rides as the quality factor's key so an operator can see it in the breakdown. */
export function lipSyncCredits(quote: LipSyncQuote, config: LipSyncProConfig, plans: AiPlansConfig): CreditEstimate {
  const mult = config.models[quote.vendor].creditMultiplier;
  const scaled = mult === 1 ? quote.totalCents : Math.round(quote.totalCents * mult);
  return calculateCredits(
    {
      feature: "ai_lip_sync",
      priceCents: scaled,
      mode: quote.speechSource === "text" ? "lip_sync_text" : "lip_sync_audio",
      durationMs: quote.durationMs,
      lines: quote.lines.filter((l) => l.amountCents > 0).map((l) => ({ label: l.label, cents: Math.round(l.amountCents * mult) })),
    },
    plans,
  );
}

function quoteKey(): string {
  const key = process.env.AI_QUOTE_SIGNING_SECRET?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error("no quote signing key configured");
  return key;
}

export function lipSyncRouteKey(vendor: LipSyncVendor, model: string): string {
  return createHash("sha256").update(`${vendor}:${model}`).digest("base64url").slice(0, 16);
}

export function lipSyncQuoteCanonical(q: LipSyncQuote): string {
  return JSON.stringify({ f: "ai_lip_sync", v: q.pricingConfigVersion, d: q.durationMs, s: q.speechSource, p: q.speechPath, n: q.textCharacters, r: q.routeKey, t: q.totalCents, c: q.currency, e: q.expiresAt });
}

/** The quote as the browser may see it: no vendor, no model, no provider-cost estimate. */
export function publicLipSyncQuote(q: LipSyncQuote) {
  const { vendor: _v, model: _m, providerCostEstimate: _c, ...shown } = q;
  void _v;
  void _m;
  void _c;
  return shown;
}

export function signLipSyncQuote(q: LipSyncQuote): string {
  return createHmac("sha256", quoteKey()).update(lipSyncQuoteCanonical(q)).digest("base64url");
}

export function verifyLipSyncQuote(q: LipSyncQuote): boolean {
  try {
    const expected = Buffer.from(signLipSyncQuote(q));
    const given = Buffer.from(q.id);
    return expected.length === given.length && timingSafeEqual(expected, given);
  } catch {
    return false;
  }
}

/** §7 / §14: about how long the spoken text will run, before it is made — ~15 characters a second at 1×, for the estimate only. */
export function estimateSpeechMs(characters: number, speed: number): number {
  const base = (Math.max(0, characters) / 15) * 1000;
  return Math.round(base / Math.max(0.5, Math.min(3, speed || 1)));
}
