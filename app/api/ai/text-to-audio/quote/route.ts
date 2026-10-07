import { NextResponse } from "next/server";

import { creditDecisionView, decideCredits, getAiCreditEntitlement } from "@/lib/ai/credits/entitlement";
import { featureContext } from "@/lib/ai/credits/feature-gate";
import { getAiEntitlement } from "@/lib/ai/entitlement";
import { aiErrorBody, aiErrorStatus } from "@/lib/ai/errors";
import { aiFeature } from "@/lib/ai/jobs";
import { subjectOwnerId } from "@/lib/ai/subject";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { readFreeCharacters } from "@/lib/ai/text-to-audio/free";
import { modelCharacterCeiling, textToAudioGate } from "@/lib/ai/text-to-audio/generate";
import { textToAudioAllowance, textToAudioCoverage } from "@/lib/ai/text-to-audio/config";
import { countTextToAudioCharacters, publicTextToAudioQuote, quoteTextToAudio, textToAudioCredits, textToAudioMonthKey, textToAudioPartialOptions } from "@/lib/ai/text-to-audio/pricing";
import { textToAudioQuoteRequestSchema } from "@/lib/ai/text-to-audio/schemas";
import { getLandingSettings } from "@/lib/landing/settings";
import { aiJobReadLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/text-to-audio/quote — the price of THIS text for THIS member
 * today: the month's free characters it would use, the billable remainder,
 * the total, and (on a plan) the credits it would take. Nothing is reserved;
 * Generate recomputes and refuses a difference. The body carries the text or
 * only its length — the estimate needs the count.
 */
export async function POST(request: Request) {
  const feature = aiFeature("ai_text_to_audio");
  if (!feature) return NextResponse.json(aiErrorBody("FEATURE_UNAVAILABLE"), { status: aiErrorStatus("FEATURE_UNAVAILABLE") });
  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") return NextResponse.json(aiErrorBody("AUTH_REQUIRED"), { status: aiErrorStatus("AUTH_REQUIRED") });
  const burst = await aiJobReadLimiter.limit(`ai-tta-quote:${subject.key}`);
  if (!burst.success) return NextResponse.json(aiErrorBody("RATE_LIMITED"), { status: aiErrorStatus("RATE_LIMITED"), headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) } });
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(aiErrorBody("INVALID_INPUT"), { status: aiErrorStatus("INVALID_INPUT") });
  }
  const parsed = textToAudioQuoteRequestSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json(aiErrorBody("INVALID_INPUT"), { status: aiErrorStatus("INVALID_INPUT") });
  try {
    const [settings, entitlement] = await Promise.all([getLandingSettings(), getAiEntitlement(subject, feature)]);
    const config = settings.frenzAiTextToAudio;
    const gate = await textToAudioGate({ settings, entitlement }, subject);
    if (!gate.ok && gate.code !== "CR_BUSY" && gate.code !== "CR_MAINTENANCE") return NextResponse.json(aiErrorBody(gate.code!, gate.extra), { status: aiErrorStatus(gate.code!) });
    const characters = parsed.data.text !== undefined ? countTextToAudioCharacters(parsed.data.text) : (parsed.data.characters ?? 0);
    const ceiling = Math.min(config.maximumCharacters, modelCharacterCeiling(gate.resolved.model));
    if (characters > ceiling) return NextResponse.json(aiErrorBody("INVALID_INPUT", { error: `Keep the text to ${ceiling.toLocaleString("en-US")} characters.`, limit: "too_long", maximumCharacters: ceiling }), { status: aiErrorStatus("INVALID_INPUT") });
    const ownerId = subjectOwnerId(subject);
    const plans = settings.frenzAiPlans;
    const monthKey = textToAudioMonthKey(new Date(), plans.reset.timezone);
    // 0185: the member's tier decides the month's characters; the partial rule decides how many of them this text may use
    // 2026-10-07: the feature rules and the plan allowance leave together (they were two round trips in a row on every quote)
    const [fctx, creditEntitlement] = await Promise.all([featureContext(ownerId, feature.id, plans), plans.enabled ? getAiCreditEntitlement(ownerId, plans) : Promise.resolve(null)]);
    const free = await readFreeCharacters(ownerId, monthKey, textToAudioAllowance(config, fctx.tier));
    const coverage = textToAudioCoverage({ characters, remaining: free.remaining, policy: config.partialAllowance, choice: parsed.data.partial ?? null });
    // while the member has not chosen, the figure shown is the cheaper option (what is left + credits) — Generate asks before taking anything
    const quote = quoteTextToAudio({ characters, freeCharactersAvailable: coverage.choiceRequired ? free.remaining : coverage.covered }, config, { currency: settings.frenzAiCurrency });
    const partial = characters > free.remaining && free.remaining > 0 ? { policy: config.partialAllowance, choiceRequired: coverage.choiceRequired, remaining: free.remaining, characters, options: textToAudioPartialOptions(characters, free.remaining, config, plans, settings.frenzAiCurrency) } : null;
    let credits: ReturnType<typeof creditDecisionView> | null = null;
    if (quote.totalCents > 0 && creditEntitlement) {
      if (creditEntitlement.plan) {
        const estimate = textToAudioCredits(quote, config, plans);
        credits = creditDecisionView(decideCredits(creditEntitlement, { feature: feature.id, priceCents: estimate.priceCents, mode: "text_to_audio", durationMs: null, lines: quote.lines.filter((l) => l.amountCents > 0).map((l) => ({ label: l.label, cents: l.amountCents })) }, plans));
      }
    }
    // 🔴 0184: what the wallet would be charged, in credits — the same engine figure a plan would count
    const walletCredits = quote.totalCents > 0 ? textToAudioCredits(quote, config, plans).creditsRequired : 0;
    return NextResponse.json({ quote: { ...publicTextToAudioQuote(quote), credits: walletCredits }, unit: "CREDIT", access: fctx.view, free: { allowance: free.allowance, used: free.used, remaining: free.remaining, afterThis: Math.max(0, free.remaining - quote.freeCharactersCovered), tier: fctx.tier, monthKey }, partial, credits, walletFallback: plans.enabled ? plans.walletFallback : "allow" });
  } catch (e) {
    console.error("[ai/tta/quote] failed", { subject: subject.key, error: String(e) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}
