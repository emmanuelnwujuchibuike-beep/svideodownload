import "server-only";

import type { CharacterReplaceConfig } from "@/lib/ai/character-replace/config";
import { quoteCharacterReplace, validateQuoteInput, type CharacterReplaceQuote } from "@/lib/ai/character-replace/pricing";
import type { StartCharacterReplaceJobRequest } from "@/lib/ai/character-replace/start-schema";
import { verifyQuoteSignature } from "@/lib/ai/character-replace/wallet";
import type { AiErrorCode } from "@/lib/ai/errors";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE QUOTE A MEMBER HANDS BACK, CHECKED THREE WAYS (Part 4, §11)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   1. GENUINE  — the HMAC the server put on it still matches every signed
 *                 field (product, version, duration, quality, voice, lip
 *                 sync, total, currency, expiry). An edited quote fails here.
 *   2. FRESH    — `expiresAt` has not passed.
 *   3. CURRENT  — recomputed from the CURRENT configuration, the total and
 *                 the pricing version are the ones on the quote. A price the
 *                 operator changed in between is refused with PRICE_CHANGED,
 *                 never honoured (a stale lower price) or raised silently.
 *
 * Only then does the recomputed quote — the server's own object, with the
 * client's id and expiry — become the immutable snapshot the reservation
 * is written under. Nothing the client sent beyond the four inputs and the
 * signed fields reaches that snapshot.
 */
export type StartVerdict = { ok: true; snapshot: CharacterReplaceQuote } | { ok: false; code: AiErrorCode; reason: string };

export function verifyStartQuote(
  body: StartCharacterReplaceJobRequest,
  config: CharacterReplaceConfig,
  money: { currency: string; symbol: string; now?: Date },
): StartVerdict {
  const q = body.quote;
  const now = money.now ?? new Date();

  // 3a. the inputs must still be ones the operator offers
  const input = { selectedDurationMs: q.durationMs, quality: q.quality, voiceMode: q.voiceMode, lipSyncMode: q.lipSyncMode };
  const verdict = validateQuoteInput(input, config);
  if (!verdict.ok) {
    const quality = config.qualities.find((x) => x.id === q.quality);
    return { ok: false, code: !quality || !quality.enabled ? "QUALITY_UNAVAILABLE" : "INVALID_INPUT", reason: verdict.reason };
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

  return { ok: true, snapshot: { ...recomputed, id: q.id, expiresAt: q.expiresAt } };
}
