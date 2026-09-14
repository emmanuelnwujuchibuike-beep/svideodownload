import { NextResponse } from "next/server";

import { affordability, quoteCharacterReplace, validateQuoteInput } from "@/lib/ai/character-replace/pricing";
import { quoteRequestSchema } from "@/lib/ai/character-replace/quote-schema";
import { getCharacterReplaceBalanceCents, signQuote } from "@/lib/ai/character-replace/wallet";
import { getAiEntitlement } from "@/lib/ai/entitlement";
import { aiErrorBody, aiErrorStatus } from "@/lib/ai/errors";
import { aiFeature } from "@/lib/ai/jobs";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { aiCurrencySymbol, getLandingSettings } from "@/lib/landing/settings";
import { aiJobReadLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/character-replace/quote — the authoritative price.
 *
 * Part 3, §5: "The frontend should submit the user's configuration. The
 * backend calculates… and returns the authoritative price."
 *
 * ── 🔴 THE BODY IS A CONFIGURATION, NEVER A PRICE ────────────────────────────
 *
 * `quoteRequestSchema` (lib/ai/character-replace/quote-schema.ts) is strict:
 * a body carrying `price`, `totalCents`, `amount`, `balance` or any field it
 * does not name is REFUSED, not stripped. The four fields that are accepted
 * are each checked against the operator's CURRENT configuration
 * (`validateQuoteInput`): a quality that is switched off, a lip-sync tier
 * without a new voice, a duration outside the window — refused with a
 * sentence, never substituted.
 *
 * The answer is the pricing snapshot (§15) signed by the server (`id`), the
 * member's Character Replace balance, and the arithmetic of §14 — required,
 * available, short by. Nothing here moves money.
 */


export async function POST(request: Request) {
  const feature = aiFeature("ai_character_replace");
  if (!feature) {
    return NextResponse.json(aiErrorBody("FEATURE_UNAVAILABLE"), { status: aiErrorStatus("FEATURE_UNAVAILABLE") });
  }
  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") {
    return NextResponse.json(aiErrorBody("AUTH_REQUIRED"), { status: aiErrorStatus("AUTH_REQUIRED") });
  }
  const burst = await aiJobReadLimiter.limit(`ai-cr-quote:${subject.key}`);
  if (!burst.success) {
    return NextResponse.json(aiErrorBody("RATE_LIMITED"), {
      status: aiErrorStatus("RATE_LIMITED"),
      headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) },
    });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(aiErrorBody("INVALID_INPUT"), { status: aiErrorStatus("INVALID_INPUT") });
  }
  const parsed = quoteRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(aiErrorBody("INVALID_INPUT"), { status: aiErrorStatus("INVALID_INPUT") });
  }

  try {
    const [settings, entitlement] = await Promise.all([getLandingSettings(), getAiEntitlement(subject, feature)]);
    const config = settings.frenzAiCharacterReplace;
    if (!entitlement.allowed || !config.enabled) {
      return NextResponse.json(aiErrorBody("FEATURE_UNAVAILABLE"), { status: aiErrorStatus("FEATURE_UNAVAILABLE") });
    }
    const verdict = validateQuoteInput(parsed.data, config);
    if (!verdict.ok) {
      return NextResponse.json(aiErrorBody("INVALID_INPUT", { error: verdict.reason }), {
        status: aiErrorStatus("INVALID_INPUT"),
      });
    }
    const quote = quoteCharacterReplace(parsed.data, config, {
      currency: settings.frenzAiCurrency,
      symbol: aiCurrencySymbol(settings.frenzAiCurrency),
    });
    quote.id = signQuote(quote);
    /*
      🔴 The balance is the PRODUCT wallet's, read here and never trusted from
      the client (§4). A failed read throws and the whole request fails —
      zero would send a member with credit to recharge again.
    */
    const balanceCents = await getCharacterReplaceBalanceCents(subject.userId);
    const money = affordability(quote.totalCents, balanceCents);
    return NextResponse.json({
      quote,
      balanceCents,
      afterCents: money.afterCents,
      sufficient: money.sufficient,
      shortfallCents: money.shortfallCents,
    });
  } catch (e) {
    console.error("[ai/cr/quote] failed", { subject: subject.key, error: String(e) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}
