import "server-only";

import type { CharacterReplaceConfig } from "@/lib/ai/character-replace/config";
import { normalizeQuoteInput, quoteCharacterReplace, validateQuoteInput, type CharacterReplaceQuote, type QuoteInput } from "@/lib/ai/character-replace/pricing";
import type { StartCharacterReplaceJobRequest } from "@/lib/ai/character-replace/start-schema";
import { verifyQuoteSignature } from "@/lib/ai/character-replace/wallet";
import type { AiErrorCode } from "@/lib/ai/errors";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE QUOTE A MEMBER HANDS BACK, CHECKED THREE WAYS (Part 4, §11)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   1. GENUINE  — the HMAC the server put on it still matches every signed
 *                 field (product, version, duration, mode, quality, voice,
 *                 voice source, dialogue length, lip sync, total, currency,
 *                 expiry). An edited quote fails here.
 *   2. FRESH    — `expiresAt` has not passed.
 *   3. CURRENT  — recomputed from the CURRENT configuration, the total and
 *                 the pricing version are the ones on the quote. A price the
 *                 operator changed in between is refused with PRICE_CHANGED,
 *                 never honoured (a stale lower price) or raised silently.
 *
 * Part 6 adds a fourth: the VOICE DETAILS the body carries must be the ones
 * the quote priced — the same source, a dialogue of exactly the signed
 * length, a language the provider speaks, a voice from the catalogue, and
 * the voice-rights confirmation for an uploaded voice (§6). None of these
 * is a price, so none is signed; all of them decide what runs.
 *
 * Only then does the recomputed quote — the server's own object, with the
 * client's id and expiry — become the immutable snapshot the reservation
 * is written under. Nothing the client sent beyond the priced inputs and
 * the signed fields reaches that snapshot.
 */
export type StartVerdict =
  | { ok: true; snapshot: CharacterReplaceQuote; voice: VerifiedVoice | null }
  | { ok: false; code: AiErrorCode; reason: string };

/** The voice choices, as the server accepted them. Null with the original audio. */
export interface VerifiedVoice {
  source: "upload" | "tts";
  text: string | null;
  languageCode: string | null;
  voiceId: string | null;
  providerVoiceId: string | null;
  trimToFit: boolean;
  voiceConsent: boolean;
}

export function verifyStartQuote(
  body: StartCharacterReplaceJobRequest,
  config: CharacterReplaceConfig,
  money: { currency: string; symbol: string; now?: Date },
  capabilities: { ttsLanguages: readonly string[] } = { ttsLanguages: [] },
): StartVerdict {
  const q = body.quote;
  const now = money.now ?? new Date();

  // 3a. the inputs must still be ones the operator offers
  const input: QuoteInput = {
    selectedDurationMs: q.durationMs,
    mode: q.mode,
    quality: q.quality,
    voiceMode: q.voiceMode,
    voiceSource: q.voiceSource ?? null,
    ttsCharacters: q.ttsCharacters ?? 0,
    lipSyncMode: q.lipSyncMode,
  };
  const verdict = validateQuoteInput(input, config);
  if (!verdict.ok) {
    const n = normalizeQuoteInput(input);
    const tierMissing = /quality/i.test(verdict.reason);
    return { ok: false, code: tierMissing ? "QUALITY_UNAVAILABLE" : "INVALID_INPUT", reason: `${verdict.reason} (${n.mode}/${n.quality})` };
  }
  if (q.currency !== money.currency) return { ok: false, code: "PRICE_CHANGED", reason: "currency changed" };

  // The trim, if any, must be the range that was priced.
  if (body.trim) {
    if (body.trim.endMs <= body.trim.startMs) return { ok: false, code: "INVALID_INPUT", reason: "empty trim" };
    if (body.trim.endMs - body.trim.startMs !== q.durationMs) return { ok: false, code: "INVALID_INPUT", reason: "trim does not match the priced duration" };
  }

  // 1. genuine — the signature over the client's own fields
  const recomputed = quoteCharacterReplace(input, config, { currency: money.currency, symbol: money.symbol, now });
  const presented: CharacterReplaceQuote = {
    ...recomputed,
    id: q.id,
    pricingConfigVersion: q.pricingConfigVersion,
    totalCents: q.totalCents,
    expiresAt: q.expiresAt,
  };
  if (!verifyQuoteSignature(presented)) return { ok: false, code: "INVALID_INPUT", reason: "quote signature does not verify" };

  // 2. fresh
  const expires = Date.parse(q.expiresAt);
  if (!Number.isFinite(expires) || expires <= now.getTime()) return { ok: false, code: "QUOTE_EXPIRED", reason: "quote expired" };

  // 3. current — the same arithmetic on today's configuration
  if (recomputed.pricingConfigVersion !== q.pricingConfigVersion || recomputed.totalCents !== q.totalCents) {
    return { ok: false, code: "PRICE_CHANGED", reason: `quoted ${q.totalCents} @v${q.pricingConfigVersion}, now ${recomputed.totalCents} @v${recomputed.pricingConfigVersion}` };
  }

  // 4. the voice details agree with the priced voice (Part 6)
  const voice = verifyVoice(body, recomputed, config, capabilities);
  if (!voice.ok) return voice;

  return { ok: true, snapshot: { ...recomputed, id: q.id, expiresAt: q.expiresAt }, voice: voice.voice };
}

function verifyVoice(
  body: StartCharacterReplaceJobRequest,
  quote: CharacterReplaceQuote,
  config: CharacterReplaceConfig,
  capabilities: { ttsLanguages: readonly string[] },
): { ok: true; voice: VerifiedVoice | null } | { ok: false; code: AiErrorCode; reason: string } {
  if (quote.voiceMode !== "new_voice") return { ok: true, voice: null };
  const v = body.voice;
  if (!v) return { ok: false, code: "INVALID_INPUT", reason: "a new voice was priced but no voice details were sent" };
  if (v.source !== quote.voiceSource) return { ok: false, code: "INVALID_INPUT", reason: `voice source ${v.source} does not match the priced ${quote.voiceSource}` };

  if (v.source === "upload") {
    if (v.voiceConsent !== true) return { ok: false, code: "INVALID_INPUT", reason: "voice rights not confirmed" };
    return { ok: true, voice: { source: "upload", text: null, languageCode: null, voiceId: null, providerVoiceId: null, trimToFit: v.trimToFit === true, voiceConsent: true } };
  }

  // tts
  const text = (v.text ?? "").trim();
  const characters = Array.from(text).length;
  if (characters === 0) return { ok: false, code: "INVALID_INPUT", reason: "no dialogue" };
  if (characters !== quote.ttsCharacters) return { ok: false, code: "INVALID_INPUT", reason: `dialogue is ${characters} characters, the price was for ${quote.ttsCharacters}` };
  const languageCode = (v.languageCode ?? "").toLowerCase();
  const language = config.languages.find((l) => l.code === languageCode);
  if (!language) return { ok: false, code: "INVALID_INPUT", reason: `language ${languageCode || "(none)"} is not offered` };
  if (!capabilities.ttsLanguages.includes(languageCode)) return { ok: false, code: "INVALID_INPUT", reason: `language ${languageCode} is not spoken by the configured voice provider` };
  const voice = config.voices.find((x) => x.id === v.voiceId);
  if (!voice) return { ok: false, code: "INVALID_INPUT", reason: `voice ${v.voiceId ?? "(none)"} is not in the catalogue` };
  if (voice.languages.length > 0 && !voice.languages.includes(languageCode)) return { ok: false, code: "INVALID_INPUT", reason: `voice ${voice.id} does not speak ${languageCode}` };
  return {
    ok: true,
    voice: { source: "tts", text, languageCode, voiceId: voice.id, providerVoiceId: voice.providerVoiceId || null, trimToFit: v.trimToFit === true, voiceConsent: v.voiceConsent === true },
  };
}
